// Phase 72: her own Alexa custom skill, written from Amazon's published rules (no SDK).
//
// POST /alexa receives Alexa's JSON. Before anything is read:
//  1. the signing certificate URL (SignatureCertChainUrl) must be https://s3.amazonaws.com[:443]/echo.api/…
//  2. the chain is downloaded (through netFetch, cached until it expires), every certificate is in
//     its validity dates, the first one names echo-api.amazon.com in its subject alternative names,
//     each one is signed by the next, and the last one is (or is signed by) a root certificate Node
//     itself trusts (`tls.rootCertificates`, Mozilla's list; Sara ships no CA bundle). Tests inject
//     their own root through `trustRoots`; nothing else can.
//  3. the Signature-256 header is an RSA SHA-256 signature of the raw body by that certificate;
//  4. the request's timestamp is within 150 seconds;
//  5. the skill id is the one the owner copied into Sara.
// Any failure answers 400 and nothing is run. Then the Alexa account (its userId, kept only as a
// hash) is looked up among the linked accounts: each was linked with a one-time six-digit code made
// in Sara (Settings → Other apps → Alexa) and belongs to one person (the owner or a household
// member) and one companion. Her turn runs in that person's space, in that companion's own "Alexa"
// conversation, as a turn from another app (private, imported and group chats stay out of it).
import { createHash, randomBytes, randomInt, timingSafeEqual, verify as verifySignature, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import type { AppContext } from './chat.ts';
import { netFetch, privateLocalOn } from './net-guard.ts';
import { externalTurn, otherAppsSettings } from './other-apps.ts';
import { DISCLOSURE_INTERVAL_MS } from './safety.ts';

export const ALEXA_CHANNEL = 'alexa';
/** Amazon allows a skill about 8 seconds; her turn gets this much, the rest is for the network. */
export const ALEXA_BUDGET_MS = 6_000;
/** After this long without her answer, Alexa says "one moment" (a progressive response). */
const PROGRESSIVE_AFTER_MS = 1_500;
const MAX_BODY = 128 * 1024;
const CODE_MS = 10 * 60_000;
const MAX_LINKS = 50;
/** The speech she sends Alexa at most (Alexa's own limit is 8000 characters of SSML). */
const MAX_SPEECH = 1_400;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------------------------
// Request signatures (Amazon: "Manually verify that the request was sent by Alexa")
// ---------------------------------------------------------------------------------------------

/** Checks a SignatureCertChainUrl. Returns why it is refused, or undefined when it is fine. */
export function certUrlProblem(raw: string | undefined): string | undefined {
  if (!raw) return 'no SignatureCertChainUrl';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'the certificate URL is not a URL';
  }
  // URL() lower-cases the scheme and host and resolves "/../" (Amazon: compare after normalizing).
  if (u.protocol !== 'https:') return 'the certificate URL is not https';
  if (u.hostname !== 's3.amazonaws.com') return 'the certificate URL is not on s3.amazonaws.com';
  if (u.port && u.port !== '443') return 'the certificate URL uses another port than 443';
  if (!u.pathname.startsWith('/echo.api/')) return 'the certificate URL is not under /echo.api/';
  if (u.username || u.password) return 'the certificate URL has a user name';
  return undefined;
}

/** The PEM certificates in a chain file, in order. */
export function parseChain(pem: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return blocks.slice(0, 8).map((b) => new X509Certificate(b));
}

let systemRoots: X509Certificate[] | undefined;
/** The root certificates Node trusts (Mozilla's list built into Node), parsed once. */
function nodeRoots(): X509Certificate[] {
  if (!systemRoots) {
    systemRoots = [];
    for (const pem of rootCertificates) {
      try {
        systemRoots.push(new X509Certificate(pem));
      } catch {
        /* a root Node can't parse is skipped */
      }
    }
  }
  return systemRoots;
}

const inDates = (c: X509Certificate, now: Date) => now.getTime() >= Date.parse(c.validFrom) && now.getTime() <= Date.parse(c.validTo);

/**
 * Checks the chain: the echo-api.amazon.com name, then from the first certificate up: each one in
 * its dates and signed by the next, until one is a root Node trusts or is signed by one. Amazon's
 * file also carries cross-signed copies of its roots after that point; those are not needed (a
 * browser builds the same shortest path) and are left alone, so an old cross-signature that expired
 * doesn't refuse a good chain.
 */
export function chainProblem(certs: X509Certificate[], now: Date, roots: X509Certificate[] = nodeRoots()): string | undefined {
  if (!certs.length) return 'the certificate chain is empty';
  const san = (certs[0].subjectAltName ?? '').split(/,\s*/).map((x) => x.trim().toLowerCase());
  if (!san.includes('dns:echo-api.amazon.com')) return 'the certificate is not for echo-api.amazon.com';
  for (let i = 0; i < certs.length; i++) {
    const c = certs[i];
    if (!inDates(c, now)) return 'a certificate in the chain has expired or is not valid yet';
    if (i > 0 && !c.ca) return 'a certificate in the chain is signed by a certificate that is not a CA';
    if (roots.some((r) => r.fingerprint256 === c.fingerprint256)) return undefined;
    if (roots.some((r) => r.ca && c.checkIssued(r) && inDates(r, now) && c.verify(r.publicKey))) return undefined;
    const issuer = certs[i + 1];
    if (!issuer) break;
    if (!c.checkIssued(issuer) || !c.verify(issuer.publicKey)) return 'the certificate chain is broken';
  }
  return 'the certificate chain does not end at a trusted root';
}

/** The request's timestamp is within 150 seconds of now. */
export function timestampOk(ts: unknown, now: Date): boolean {
  const t = Date.parse(String(ts ?? ''));
  return Number.isFinite(t) && Math.abs(now.getTime() - t) <= 150_000;
}

/** Downloaded chains, kept until their first certificate expires (or a day, whichever is first). */
export class CertCache {
  readonly #items = new Map<string, { certs: X509Certificate[]; until: number }>();
  readonly #fetch: FetchLike;
  constructor(fetchImpl: FetchLike = netFetch) {
    this.#fetch = fetchImpl;
  }
  async get(url: string, now: Date): Promise<X509Certificate[]> {
    const hit = this.#items.get(url);
    if (hit && hit.until > now.getTime()) return hit.certs;
    const res = await this.#fetch(url, { redirect: 'error', signal: AbortSignal.timeout(4_000) });
    if (!res.ok) throw new Error(`the certificate download answered ${res.status}`);
    const text = await res.text();
    if (text.length > 64 * 1024) throw new Error('the certificate file is too large');
    const certs = parseChain(text);
    if (!certs.length) throw new Error('the certificate file has no certificates');
    if (this.#items.size > 20) this.#items.clear();
    this.#items.set(url, { certs, until: Math.min(Date.parse(certs[0].validTo), now.getTime() + 86_400_000) });
    return certs;
  }
}

export interface VerifyOptions {
  certs: CertCache;
  now: Date;
  /** Tests only: their own root certificate instead of Node's list. */
  trustRoots?: X509Certificate[];
}

/** Verifies one request from Alexa. Returns why it is refused, or undefined when it is genuine. */
export async function verifyAlexaRequest(headers: IncomingMessage['headers'], raw: Buffer, body: { request?: { timestamp?: unknown } }, o: VerifyOptions): Promise<string | undefined> {
  const url = String(headers['signaturecertchainurl'] ?? '');
  const bad = certUrlProblem(url);
  if (bad) return bad;
  const sig = String(headers['signature-256'] ?? '');
  if (!sig || !/^[A-Za-z0-9+/=]+$/.test(sig)) return 'no Signature-256 header';
  let certs: X509Certificate[];
  try {
    certs = await o.certs.get(url, o.now);
  } catch (err) {
    return `the signing certificate could not be downloaded (${(err as Error).message})`;
  }
  const chain = chainProblem(certs, o.now, o.trustRoots ?? nodeRoots());
  if (chain) return chain;
  let ok = false;
  try {
    ok = verifySignature('sha256', raw, certs[0].publicKey, Buffer.from(sig, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) return 'the signature does not match the request';
  if (!timestampOk(body.request?.timestamp, o.now)) return 'the request is too old (more than 150 seconds)';
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------------------------

/** Her reply as plain spoken words: no markdown, code, emoji or long links; cut at a sentence. */
export function speechText(input: string, max = MAX_SPEECH): string {
  let s = String(input ?? '');
  s = s.replace(/```[\s\S]*?(```|$)/g, ' (I left out some code: it is in the Sara app.) ');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1');
  s = s.replace(/https?:\/\/([^\s/)]+)(\/[^\s)]*)?/gi, (_m, host: string) => host.replace(/^www\./, ''));
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*[-*+•]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '').replace(/^\s*>\s?/gm, '');
  s = s.replace(/(\*\*|__|\*|_|~~)(\S(?:[\s\S]*?\S)?)\1/g, '$2');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  // Emoji, pictographs, variation selectors, joiners, keycaps and flags.
  s = s.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, '');
  // Control characters (not newlines) never reach Alexa.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\s*\n+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = `${end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`} The rest is in the Sara app.`;
  }
  return s;
}

/** Escapes text for SSML (XML): & < > " ' . */
export function escapeSsml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Plain words → `<speak>…</speak>`, safe for SSML. */
export function ssml(text: string): string {
  return `<speak>${escapeSsml(speechText(text))}</speak>`;
}

export interface AlexaResponse {
  version: '1.0';
  sessionAttributes?: Record<string, unknown>;
  response: {
    outputSpeech?: { type: 'SSML'; ssml: string };
    reprompt?: { outputSpeech: { type: 'SSML'; ssml: string } };
    shouldEndSession?: boolean;
  };
}

/** One spoken answer; `listen` keeps the session open for a follow-up (with a short reprompt). */
export function say(text: string, listen: boolean, reprompt = 'Anything else?'): AlexaResponse {
  return {
    version: '1.0',
    sessionAttributes: {},
    response: {
      outputSpeech: { type: 'SSML', ssml: ssml(text) },
      ...(listen ? { reprompt: { outputSpeech: { type: 'SSML', ssml: ssml(reprompt) } } } : {}),
      shouldEndSession: !listen,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Linked Alexa accounts and one-time link codes (<data>/alexa.json; the owner's data folder)
// ---------------------------------------------------------------------------------------------

export interface AlexaLink {
  id: string;
  /** sha256 of the Alexa userId (the id itself is never stored). */
  user: string;
  /** 'owner' or a household member's id. */
  space: string;
  companion: string;
  linkedAt: string;
  lastUsedAt?: string;
  /** When she last said she is an AI on this Alexa (the spoken notice, every session and 3 hours). */
  toldAt?: string;
}

interface LinkCode {
  hash: string;
  space: string;
  companion: string;
  expiresAt: string;
}

interface AlexaFile {
  links: AlexaLink[];
  codes: LinkCode[];
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export class AlexaLinks {
  readonly #file: string;
  readonly #now: () => Date;
  /** Wrong codes per Alexa account and for the whole server (slows down guessing). */
  readonly #misses = new Map<string, number[]>();

  constructor(dir: string, now: () => Date = () => new Date()) {
    this.#file = join(dir, 'alexa.json');
    this.#now = now;
  }

  #read(): AlexaFile {
    if (!existsSync(this.#file)) return { links: [], codes: [] };
    try {
      const v = JSON.parse(readFileSync(this.#file, 'utf8')) as Partial<AlexaFile>;
      return { links: Array.isArray(v.links) ? v.links : [], codes: Array.isArray(v.codes) ? v.codes : [] };
    } catch {
      return { links: [], codes: [] };
    }
  }

  #write(f: AlexaFile): void {
    const now = this.#now().getTime();
    f.codes = f.codes.filter((c) => Date.parse(c.expiresAt) > now);
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify(f, null, 2), { mode: 0o600 });
    renameSync(tmp, this.#file);
  }

  /** A new six-digit code for this person and companion (10 minutes, once). Replaces their older code. */
  makeCode(space: string, companion: string): { code: string; expiresAt: string } {
    const f = this.#read();
    if (f.links.length >= MAX_LINKS) throw new Error('Up to 50 Alexa accounts can be linked. Unlink one first.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(this.#now().getTime() + CODE_MS).toISOString();
    f.codes = f.codes.filter((c) => !(c.space === space && c.companion === companion));
    f.codes.push({ hash: sha(`alexa-code:${code}`), space, companion, expiresAt });
    this.#write(f);
    return { code, expiresAt };
  }

  /** Too many wrong codes lately (from this Alexa account, or from anyone). */
  #blocked(userHash: string, now: number): boolean {
    const recent = (k: string) => (this.#misses.get(k) ?? []).filter((t) => now - t < CODE_MS);
    return recent(userHash).length >= 5 || recent('*').length >= 30;
  }

  #miss(userHash: string, now: number): void {
    for (const k of [userHash, '*']) this.#misses.set(k, [...(this.#misses.get(k) ?? []).filter((t) => now - t < CODE_MS), now]);
  }

  /** Uses a code: links this Alexa account (replacing an older link of the same account). */
  redeem(code: string, userId: string): AlexaLink | 'blocked' | undefined {
    const now = this.#now().getTime();
    const user = sha(userId);
    if (this.#blocked(user, now)) return 'blocked';
    const digits = String(code ?? '').replace(/\D/g, '');
    const f = this.#read();
    const want = Buffer.from(sha(`alexa-code:${digits.padStart(6, '0')}`));
    const hit = digits.length >= 1 && digits.length <= 6 ? f.codes.find((c) => Date.parse(c.expiresAt) > now && timingSafeEqual(Buffer.from(c.hash), want)) : undefined;
    if (!hit) {
      this.#miss(user, now);
      return undefined;
    }
    f.codes = f.codes.filter((c) => c !== hit);
    f.links = f.links.filter((l) => l.user !== user);
    const link: AlexaLink = { id: randomBytes(6).toString('base64url'), user, space: hit.space, companion: hit.companion, linkedAt: new Date(now).toISOString() };
    f.links.push(link);
    this.#write(f);
    return link;
  }

  find(userId: string): AlexaLink | undefined {
    const user = sha(String(userId ?? ''));
    return this.#read().links.find((l) => l.user === user);
  }

  /** The links of one person (never anyone else's). */
  list(space: string): AlexaLink[] {
    return this.#read().links.filter((l) => l.space === space);
  }

  /** A code waiting for this person (to show its expiry), if any. */
  pendingCode(space: string, companion: string): string | undefined {
    const now = this.#now().getTime();
    return this.#read().codes.find((c) => c.space === space && c.companion === companion && Date.parse(c.expiresAt) > now)?.expiresAt;
  }

  unlink(space: string, id: string): boolean {
    const f = this.#read();
    const n = f.links.length;
    f.links = f.links.filter((l) => !(l.space === space && l.id === id));
    if (f.links.length === n) return false;
    this.#write(f);
    return true;
  }

  /** Everything of a person (a removed household member). */
  removeSpace(space: string): void {
    const f = this.#read();
    if (!f.links.some((l) => l.space === space) && !f.codes.some((c) => c.space === space)) return;
    f.links = f.links.filter((l) => l.space !== space);
    f.codes = f.codes.filter((c) => c.space !== space);
    this.#write(f);
  }

  update(id: string, patch: Partial<Pick<AlexaLink, 'lastUsedAt' | 'toldAt'>>): void {
    const f = this.#read();
    const l = f.links.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, patch);
    this.#write(f);
  }
}

// ---------------------------------------------------------------------------------------------
// The skill
// ---------------------------------------------------------------------------------------------

export interface AlexaServiceOptions {
  dir: string;
  /** The skill id the owner copied from the Alexa developer console. */
  skillId: () => string | undefined;
  /** Use the quick model for her Alexa replies. */
  quick: () => boolean;
  /** The companion a link talks to (in that person's space), or undefined (removed, paused). */
  resolve: (link: AlexaLink) => AppContext | undefined;
  now?: () => Date;
  fetchImpl?: FetchLike;
  /** Tests only: a root certificate of their own (never set outside tests). */
  trustRoots?: X509Certificate[];
  budgetMs?: number;
}

interface Pending {
  done: boolean;
  speech?: string;
  started: number;
}

interface AlexaBody {
  version?: string;
  session?: { new?: boolean; application?: { applicationId?: string }; user?: { userId?: string } };
  context?: { System?: { application?: { applicationId?: string }; user?: { userId?: string }; apiEndpoint?: string; apiAccessToken?: string } };
  request?: { type?: string; requestId?: string; timestamp?: string; reason?: string; intent?: { name?: string; slots?: Record<string, { value?: string }> } };
}

/** Intents whose first word is part of what was said ("what time is it": the slot holds "time is it"). */
export const PREFIX_INTENTS: Readonly<Record<string, string>> = {
  WhatIntent: 'what',
  HowIntent: 'how',
  WhyIntent: 'why',
  WhoIntent: 'who',
  WhereIntent: 'where',
  WhenIntent: 'when',
  CanYouIntent: 'can you',
  DoYouIntent: 'do you',
  AreYouIntent: 'are you',
  IAmIntent: "I'm",
  IIntent: 'I',
  MyIntent: 'my',
  LetsIntent: "let's",
  PleaseIntent: 'please',
  RemindMeIntent: 'remind me',
  GoodIntent: 'good',
};

const STOP_WORDS = /^(stop|cancel|bye|goodbye|good bye|that's all|nothing|no thanks?|never ?mind)\.?$/i;
const AGAIN_WORDS = /^(again|ask again|what did you find|what did you say|are you done|is it ready|tell me now|go on)\??$/i;

export class AlexaService {
  readonly links: AlexaLinks;
  readonly #o: AlexaServiceOptions;
  readonly #certs: CertCache;
  readonly #pending = new Map<string, Pending>();

  constructor(o: AlexaServiceOptions) {
    this.#o = o;
    this.links = new AlexaLinks(o.dir, o.now);
    this.#certs = new CertCache(o.fetchImpl ?? netFetch);
  }

  #now(): Date {
    return this.#o.now?.() ?? new Date();
  }

  /** POST /alexa. Never on the demo server, never in private local mode (it needs Amazon). */
  async handle(req: IncomingMessage, res: ServerResponse, flags: { demo?: boolean } = {}): Promise<void> {
    const send = (status: number, body: unknown) => {
      if (res.headersSent) return void res.end();
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (flags.demo) return send(404, { error: 'Alexa is not available on the demo server.' });
    if ((req.method ?? 'GET') !== 'POST') return send(405, { error: 'Alexa sends POST requests.' });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > MAX_BODY) return send(413, { error: 'Request too large.' });
      chunks.push(c);
    }
    if (privateLocalOn()) return send(403, { error: 'Private local mode is on: Alexa needs Amazon, so she does not answer it.' });
    const raw = Buffer.concat(chunks);
    let body: AlexaBody;
    try {
      body = JSON.parse(raw.toString('utf8')) as AlexaBody;
    } catch {
      return send(400, { error: 'Not JSON.' });
    }
    if (!body || typeof body !== 'object') return send(400, { error: 'Not an Alexa request.' });
    const why = await verifyAlexaRequest(req.headers, raw, body, { certs: this.#certs, now: this.#now(), ...(this.#o.trustRoots ? { trustRoots: this.#o.trustRoots } : {}) });
    if (why) {
      console.warn(`Alexa: refused a request (${why}).`);
      return send(400, { error: 'The request could not be verified.' });
    }
    const skill = this.#o.skillId()?.trim();
    const appId = body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId;
    if (!skill || appId !== skill) {
      console.warn('Alexa: refused a request for another skill id (Settings → Other apps → Alexa).');
      return send(400, { error: 'This skill is not the one set up in Sara.' });
    }
    try {
      return send(200, await this.respond(body));
    } catch (err) {
      console.warn(`Alexa: ${(err as Error).message}`);
      return send(200, say('Sorry, something went wrong on her server. Try again in a moment.', false));
    }
  }

  /** The answer to a verified request. */
  async respond(body: AlexaBody): Promise<AlexaResponse> {
    const r = body.request ?? {};
    const userId = body.context?.System?.user?.userId ?? body.session?.user?.userId ?? '';
    if (r.type === 'SessionEndedRequest') return { version: '1.0', response: {} };
    const intent = r.intent?.name ?? '';
    if (intent === 'AMAZON.StopIntent' || intent === 'AMAZON.CancelIntent') return say('Bye for now.', false);
    if (intent === 'LinkIntent') return this.#link(userId, r.intent?.slots?.code?.value);
    const link = userId ? this.links.find(userId) : undefined;
    if (!link) {
      if (intent === 'AMAZON.HelpIntent' || r.type === 'LaunchRequest' || !intent) return say(UNLINKED, true, 'Say: link code, and then the six numbers.');
      return say(`This Alexa isn't linked to anyone on her server yet. ${UNLINKED}`, true, 'Say: link code, and then the six numbers.');
    }
    const app = this.#o.resolve(link);
    if (!app) return say('This Alexa was linked to someone who is no longer on her server, or whose account is paused. Link it again with a new code from the Sara app.', false);
    const name = app.persona.name;
    if (!app.settings.get().disclosureAcceptedAt) return say(`Open ${name} in the Sara app or a browser once and accept the AI notice first. Then ask again.`, false);
    const now = this.#now();
    // The spoken AI notice: at every new Alexa session and every 3 hours (Phase 72 rule).
    const toldDue = body.session?.new === true || !link.toldAt || now.getTime() - Date.parse(link.toldAt) >= DISCLOSURE_INTERVAL_MS;
    const tell = toldDue ? `${name} here, your AI companion. ` : '';
    const done = (text: string, listen = true): AlexaResponse => {
      this.links.update(link.id, { lastUsedAt: now.toISOString(), ...(toldDue ? { toldAt: now.toISOString() } : {}) });
      return say(`${tell}${text}`, listen, 'Anything else?');
    };
    // An answer that took longer last time.
    const waiting = this.#pending.get(link.id);
    if (waiting && now.getTime() - waiting.started > 15 * 60_000) this.#pending.delete(link.id);
    const said = this.#utterance(intent, r.intent?.slots);
    if (r.type === 'LaunchRequest' || (!said && !intent)) {
      if (waiting?.done) {
        this.#pending.delete(link.id);
        return done(`Here's my answer to what you asked before. ${waiting.speech}`);
      }
      return done(waiting ? 'I am still thinking about what you asked. Ask me again in a moment.' : 'What would you like to say?');
    }
    if (intent === 'AMAZON.HelpIntent') return done(`You're talking with ${name}, an AI companion, through her Sara server. Just say what's on your mind, for example: tell her about my day. Say stop to end.`);
    if (intent === 'AMAZON.NavigateHomeIntent') return say('Bye for now.', false);
    if (intent === 'AMAZON.FallbackIntent' || !said) return done(`Sorry, I didn't catch that. Start with "tell her", for example: tell her I'm home.`);
    if (STOP_WORDS.test(said.trim())) return say('Bye for now.', false);
    if (waiting) {
      if (!waiting.done) return done('I am still thinking about what you asked. Ask me again in a moment.');
      this.#pending.delete(link.id);
      const again = AGAIN_WORDS.test(said.trim());
      return done(`${again ? '' : "First, my answer to what you asked before. "}${waiting.speech}${again ? '' : ' If you asked something new just now, say it again.'}`);
    }
    return this.#talk(link, app, said, body, done);
  }

  #utterance(intent: string, slots?: Record<string, { value?: string }>): string {
    const q = String(slots?.query?.value ?? '').trim();
    if (intent === 'TalkIntent') return q;
    const prefix = PREFIX_INTENTS[intent];
    return prefix && q ? `${prefix} ${q}` : prefix ?? '';
  }

  #link(userId: string, code: string | undefined): AlexaResponse {
    if (!userId) return say('I could not tell which Alexa account this is.', false);
    if (!code || !/\d/.test(code)) return say('Say: link code, and then the six numbers from the Sara app.', true, 'Say: link code, and then the six numbers.');
    const link = this.links.redeem(code, userId);
    if (link === 'blocked') return say('Too many wrong codes. Wait ten minutes, then make a new code in the Sara app.', false);
    if (!link) return say("That code didn't work. Codes work once, for ten minutes. Make a new one in the Sara app: Settings, Other apps, Alexa.", true, 'Say: link code, and then the six numbers.');
    const app = this.#o.resolve(link);
    const name = app?.persona.name ?? 'Sara';
    this.links.update(link.id, { toldAt: this.#now().toISOString() });
    console.log('Alexa: an Alexa account was linked.');
    return say(`Linked. You're now talking with ${name}. ${name} is an AI companion, not a human. What would you like to say?`, true);
  }

  async #talk(link: AlexaLink, app: AppContext, text: string, body: AlexaBody, done: (t: string, listen?: boolean) => AlexaResponse): Promise<AlexaResponse> {
    const convId = alexaConversation(app, link.id);
    const opts = { noTools: !otherAppsSettings(app.settings.get()).tools, externalApp: true, ...(this.#o.quick() ? { quickModel: true } : {}) };
    const entry: Pending = { done: false, started: this.#now().getTime() };
    const turn = externalTurn(app, convId, text, opts, { stopOnApproval: true }).then((r) => {
      let words: string;
      if (r.busy) words = `${app.persona.name} is still answering something else. Ask me again in a moment.`;
      else if (r.waiting) words = `${[...r.notices, r.text].filter((x) => x.trim()).join(' ')} I need your OK in the Sara app for that: ${r.waiting}`;
      else if (r.error && !r.text.trim()) words = `${r.notices.join(' ')} Sorry, I couldn't answer just now. ${/model|provider|key|limit/i.test(r.error) ? 'Check her model in the Sara app.' : 'Try again in a moment.'}`;
      else words = [...r.notices, r.text].filter((x) => x.trim()).join(' ');
      entry.done = true;
      entry.speech = speechText(words);
      return entry.speech;
    });
    const budget = this.#o.budgetMs ?? ALEXA_BUDGET_MS;
    const progressive = setTimeout(() => void this.#progressive(body).catch(() => {}), Math.min(PROGRESSIVE_AFTER_MS, Math.max(0, budget - 500)));
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<undefined>((r) => (timer = setTimeout(() => r(undefined), budget)));
    const speech = await Promise.race([turn, late]);
    clearTimeout(progressive);
    clearTimeout(timer);
    if (speech !== undefined) return done(speech);
    // Too slow for Alexa: the answer is kept and given on the next ask.
    this.#pending.set(link.id, entry);
    void turn.catch(() => {
      entry.done = true;
      entry.speech = 'Sorry, I lost my answer. Ask me again.';
    });
    return done("I need a little more time for that. Ask me again in a moment, for example: what did you find?");
  }

  /** "One moment." through Alexa's progressive response API (only to Amazon's own API hosts). */
  async #progressive(body: AlexaBody): Promise<void> {
    const sys = body.context?.System;
    const requestId = body.request?.requestId;
    if (!sys?.apiEndpoint || !sys.apiAccessToken || !requestId) return;
    let u: URL;
    try {
      u = new URL(sys.apiEndpoint);
    } catch {
      return;
    }
    if (u.protocol !== 'https:' || !/^api(\.(eu|fe))?\.amazonalexa\.com$/.test(u.hostname) || (u.port && u.port !== '443')) return;
    await (this.#o.fetchImpl ?? netFetch)(`${u.origin}/v1/directives`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sys.apiAccessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ header: { requestId }, directive: { type: 'VoicePlayer.Speak', speech: '<speak>One moment.</speak>' } }),
      signal: AbortSignal.timeout(3_000),
      redirect: 'error',
    });
  }

  /** Test hook: the answer kept for a link (when her reply took too long), if any. */
  pendingFor(linkId: string): { done: boolean; speech?: string } | undefined {
    const p = this.#pending.get(linkId);
    return p ? { done: p.done, ...(p.speech !== undefined ? { speech: p.speech } : {}) } : undefined;
  }
}

const UNLINKED = "Hi! This is Sara, an AI companion. To talk with her here, open the Sara app: Settings, Other apps, Alexa, and make a link code. Then say: link code, and the six numbers.";

/** The companion's own conversation for one linked Alexa (channel 'alexa'). */
export function alexaConversation(app: AppContext, linkId: string): string {
  const found = app.store.findChannelConversation(ALEXA_CHANNEL, linkId);
  if (found) return found.id;
  return app.store.createConversation({ title: 'Alexa', channel: ALEXA_CHANNEL, channelKey: linkId }).id;
}

// ---------------------------------------------------------------------------------------------
// The interaction model (Settings → Other apps → Alexa → Download, and integrations/alexa/)
// ---------------------------------------------------------------------------------------------

/** Words she drops ("tell her I'm home" → "I'm home"). */
const TALK_SAMPLES = ['tell her {query}', 'tell you {query}', 'say {query}', 'I want to say {query}', 'I want to tell you {query}', 'tell her that {query}', 'ask her {query}', 'and {query}', 'so {query}', 'well {query}', 'okay {query}', 'yes {query}', 'no {query}', 'hey {query}', 'hi {query}', 'hello {query}', 'listen {query}', 'guess what {query}', 'by the way {query}', 'also {query}', 'actually {query}', 'oh {query}'];
/** The kept first words, with a few ways each is said. */
const PREFIX_SAMPLES: Readonly<Record<string, string[]>> = {
  WhatIntent: ['what {query}', "what's {query}"],
  HowIntent: ['how {query}', "how's {query}"],
  WhyIntent: ['why {query}'],
  WhoIntent: ['who {query}', "who's {query}"],
  WhereIntent: ['where {query}', "where's {query}"],
  WhenIntent: ['when {query}'],
  CanYouIntent: ['can you {query}', 'could you {query}', 'would you {query}', 'will you {query}'],
  DoYouIntent: ['do you {query}', 'did you {query}', 'have you {query}'],
  AreYouIntent: ['are you {query}', 'were you {query}'],
  IAmIntent: ["I'm {query}", 'I am {query}'],
  IIntent: ['I {query}', "I've {query}", "I'll {query}", "I'd {query}"],
  MyIntent: ['my {query}'],
  LetsIntent: ["let's {query}", 'let us {query}'],
  PleaseIntent: ['please {query}'],
  RemindMeIntent: ['remind me {query}'],
  GoodIntent: ['good {query}'],
};

/** The interaction model JSON for the Alexa developer console (JSON Editor), en-US. */
export function alexaModel(invocationName = 'sara companion'): unknown {
  const slot = [{ name: 'query', type: 'AMAZON.SearchQuery' }];
  return {
    interactionModel: {
      languageModel: {
        invocationName,
        intents: [
          { name: 'AMAZON.CancelIntent', samples: [] },
          { name: 'AMAZON.HelpIntent', samples: [] },
          { name: 'AMAZON.StopIntent', samples: ['bye', 'goodbye', "that's all"] },
          { name: 'AMAZON.NavigateHomeIntent', samples: [] },
          { name: 'AMAZON.FallbackIntent', samples: [] },
          { name: 'LinkIntent', slots: [{ name: 'code', type: 'AMAZON.NUMBER' }], samples: ['link code {code}', 'link {code}', 'the code is {code}', 'my code is {code}', 'link with code {code}', 'link my account with {code}', 'code {code}'] },
          { name: 'TalkIntent', slots: slot, samples: TALK_SAMPLES },
          ...Object.entries(PREFIX_SAMPLES).map(([name, samples]) => ({ name, slots: slot, samples })),
        ],
        types: [],
      },
    },
  };
}
