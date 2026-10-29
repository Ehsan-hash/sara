// Phase 72: her voice in the home. Alexa (request signatures checked by Amazon's rules against a
// test CA made here, skill id, one-time link codes, routing to the right person and companion,
// the spoken AI notice, private chats out of reach, demo and private local mode refusals, SSML
// escaping, the time budget) and smart-home presence through a fake Home Assistant (rate limits,
// quiet hours, speaker announcements with the AI notice, owner-only routes).
import assert from 'node:assert/strict';
import { sign, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { alexaModel, AlexaService, certUrlProblem, chainProblem, escapeSsml, parseChain, PREFIX_INTENTS, speechText, ssml, timestampOk } from '../src/alexa.ts';
import { OwnerAuth } from '../src/auth.ts';
import type { AppContext, ChatEvent } from '../src/chat.ts';
import { memberRouteCheck, MEMBER_ROUTES, type MemberRecord } from '../src/household.ts';
import { setPrivateLocal } from '../src/net-guard.ts';
import { cleanPresence, DEFAULT_PRESENCE, PresenceWorker } from '../src/presence.ts';
import { isVoiceRoomChannel, MINOR_BLOCK_REPLY } from '../src/safety.ts';
import { createSaraServer } from '../src/server.ts';
import { HOME_VAULT } from '../src/tools/home.ts';
import { listen, makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';
import { makeChain } from './x509-test.ts';

const closers: (() => void)[] = [];
after(() => {
  for (const c of closers.reverse()) c();
});
function scratch(): string {
  const t = tempDir();
  closers.push(t.cleanup);
  return t.dir;
}

const SKILL = 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555';
const CERT_URL = 'https://s3.amazonaws.com/echo.api/echo-api-cert-test.pem';
const clock = { now: new Date('2026-10-29T15:00:00Z') };
const chain = makeChain(clock.now);
const root = new X509Certificate(chain.root.pem);
const certFetch = async (url: string) => (url === CERT_URL ? new Response(chain.chainPem) : new Response('no', { status: 404 }));

function setupApp(dir: string, name?: string): TestApp {
  const app = makeApp(dir, clock);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'UTC', disclosureAcceptedAt: clock.now.toISOString(), alexa: { skillId: SKILL } });
  if (name) app.persona = { ...app.persona, name };
  closers.push(() => app.store.close());
  return app;
}

/** An Alexa request body (LaunchRequest / IntentRequest / SessionEndedRequest). */
function alexaBody(type: string, o: { user?: string; intent?: string; slots?: Record<string, string>; skill?: string; newSession?: boolean; at?: Date } = {}): Record<string, unknown> {
  const user = o.user ?? 'amzn1.ask.account.TESTUSER';
  const app = { applicationId: o.skill ?? SKILL };
  return {
    version: '1.0',
    session: { new: o.newSession ?? false, sessionId: 'amzn1.echo-api.session.1', application: app, user: { userId: user } },
    context: { System: { application: app, user: { userId: user }, apiEndpoint: 'https://api.amazonalexa.com', apiAccessToken: 'test-token' } },
    request: {
      type,
      requestId: 'amzn1.echo-api.request.1',
      timestamp: (o.at ?? clock.now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      locale: 'en-US',
      ...(o.intent ? { intent: { name: o.intent, confirmationStatus: 'NONE', slots: Object.fromEntries(Object.entries(o.slots ?? {}).map(([k, v]) => [k, { name: k, value: v }])) } } : {}),
    },
  };
}

/** Signs like Alexa: Signature-256 = RSA-SHA256 over the raw body with the leaf's key. */
function signed(body: unknown, o: { key?: import('node:crypto').KeyObject; url?: string } = {}): { raw: string; headers: Record<string, string> } {
  const raw = JSON.stringify(body);
  return { raw, headers: { 'content-type': 'application/json', signaturecertchainurl: o.url ?? CERT_URL, 'signature-256': sign('sha256', Buffer.from(raw), o.key ?? chain.leaf.key).toString('base64') } };
}

interface Spoken {
  status: number;
  speech: string;
  end?: boolean;
  json: { response?: { outputSpeech?: { ssml: string }; shouldEndSession?: boolean } };
}
async function post(base: string, body: unknown, o: Parameters<typeof signed>[1] & { tamper?: boolean } = {}): Promise<Spoken> {
  const s = signed(body, o);
  const r = await fetch(`${base}/alexa`, { method: 'POST', headers: s.headers, body: o.tamper ? s.raw.replace('LaunchRequest', 'IntentRequest') : s.raw });
  const json = (await r.json()) as Spoken['json'];
  const ssmlText = json.response?.outputSpeech?.ssml ?? '';
  return { status: r.status, speech: ssmlText.replace(/^<speak>|<\/speak>$/g, ''), end: json.response?.shouldEndSession, json };
}

// ---------------------------------------------------------------------------------------------
// Signatures, certificates and timestamps
// ---------------------------------------------------------------------------------------------

test('certificate URL rules (Amazon\'s list): https, s3.amazonaws.com, /echo.api/, port 443', () => {
  for (const ok of ['https://s3.amazonaws.com/echo.api/echo-api-cert.pem', 'https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem', 'HTTPS://S3.AMAZONAWS.COM/echo.api/echo-api-cert.pem', 'https://s3.amazonaws.com/echo.api/../echo.api/echo-api-cert.pem']) assert.equal(certUrlProblem(ok), undefined, ok);
  for (const bad of ['http://s3.amazonaws.com/echo.api/echo-api-cert.pem', 'https://notamazon.com/echo.api/echo-api-cert.pem', 'https://s3.amazonaws.com.evil.example/echo.api/x.pem', 'https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem', 'https://s3.amazonaws.com/invalid.path/echo-api-cert.pem', 'https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem', 'https://s3.amazonaws.com/echo.api/../invalid.path/echo-api-cert.pem', 'https://user@s3.amazonaws.com/echo.api/x.pem', '', 'not a url']) assert.ok(certUrlProblem(bad), bad);
});

test('certificate chain: the test CA passes; expired, wrong name, unknown root and a broken chain fail', () => {
  const certs = parseChain(chain.chainPem);
  assert.equal(certs.length, 2);
  assert.equal(chainProblem(certs, clock.now, [root]), undefined);
  assert.match(String(chainProblem(certs, clock.now)), /trusted root/, 'Node\'s own roots don\'t know the test CA');
  const expired = makeChain(clock.now, { leafExpired: true });
  assert.match(String(chainProblem(parseChain(expired.chainPem), clock.now, [new X509Certificate(expired.root.pem)])), /expired/);
  assert.match(String(chainProblem(certs, new Date(clock.now.getTime() + 40 * 86_400_000), [root])), /expired/, 'the leaf runs out after 30 days');
  const wrong = makeChain(clock.now, { dns: 'echo-api.amazon.com.evil.example' });
  assert.match(String(chainProblem(parseChain(wrong.chainPem), clock.now, [new X509Certificate(wrong.root.pem)])), /echo-api\.amazon\.com/);
  const other = makeChain(clock.now);
  // Leaf of one chain with the intermediate of another: the link doesn't verify.
  assert.match(String(chainProblem(parseChain(chain.leaf.pem + other.inter.pem), clock.now, [root, new X509Certificate(other.root.pem)])), /broken|trusted root/);
  assert.match(String(chainProblem([], clock.now, [root])), /empty/);
});

// The fixture is Amazon's public signing chain from https://s3.amazonaws.com/echo.api/echo-api-cert-12.pem
// (public certificates only; kept as .txt because *.pem is gitignored).
test('a real Amazon echo-api chain verifies against Node\'s own roots in its validity dates (and is refused now it has expired)', () => {
  const certs = parseChain(readFileSync(join(ROOT, 'test', 'fixtures', 'alexa', 'amazon-echo-api-chain-12.txt'), 'utf8'));
  assert.ok(certs.length >= 2);
  const inside = new Date(Date.parse(certs[0].validFrom) + 86_400_000);
  assert.equal(chainProblem(certs, inside), undefined, 'chains to Amazon Root CA 1 in Node\'s root list');
  assert.match(String(chainProblem(certs, new Date('2026-10-29T00:00:00Z'))), /expired/);
});

test('timestamps: within 150 seconds either way', () => {
  assert.ok(timestampOk('2026-10-29T15:02:29Z', clock.now));
  assert.ok(timestampOk('2026-10-29T14:57:31Z', clock.now));
  assert.ok(!timestampOk('2026-10-29T15:02:31Z', clock.now));
  assert.ok(!timestampOk('2026-10-29T14:57:29Z', clock.now));
  assert.ok(!timestampOk('yesterday', clock.now));
});

// ---------------------------------------------------------------------------------------------
// The skill through a real server
// ---------------------------------------------------------------------------------------------

const ownerDir = scratch();
const owner = setupApp(ownerDir);
const auth = new OwnerAuth(ownerDir, () => clock.now);
const ownerToken = auth.newToken!;
const progressive: string[] = [];
const service = new AlexaService({
  dir: ownerDir,
  skillId: () => owner.settings.get().alexa?.skillId,
  quick: () => owner.settings.get().alexa?.quick === true,
  resolve: (l) => (l.space === 'owner' ? owner : undefined),
  now: () => clock.now,
  trustRoots: [root],
  fetchImpl: async (url, init) => {
    if (String(url).includes('/v1/directives')) {
      progressive.push(String(init?.body ?? ''));
      return new Response('', { status: 204 });
    }
    return certFetch(String(url));
  },
});
const server = createSaraServer({ app: owner, auth, webDir: join(ROOT, 'web'), alexa: service });
const demoDir = scratch();
const demoApp = setupApp(demoDir);
const demo = createSaraServer({ app: demoApp, auth: new OwnerAuth(demoDir, () => clock.now), webDir: join(ROOT, 'web'), demo: true, alexa: service });
let base = '';
let demoBase = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await new Promise<void>((r) => demo.listen(0, '127.0.0.1', r));
  demoBase = `http://127.0.0.1:${(demo.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  demo.close();
});
const api = async (method: string, path: string, body?: unknown, b = base) => {
  const r = await fetch(`${b}/api${path}`, { method, headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json', origin: b }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

test('refused before anything is read: no signature, bad signature, tampered body, bad cert URL, old timestamp, wrong skill id', async () => {
  const body = alexaBody('LaunchRequest');
  const raw = JSON.stringify(body);
  const none = await fetch(`${base}/alexa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
  assert.equal(none.status, 400);
  const other = makeChain(clock.now);
  assert.equal((await post(base, body, { key: other.leaf.key })).status, 400, 'signed by a key that isn\'t the certificate\'s');
  assert.equal((await post(base, body, { tamper: true })).status, 400, 'body changed after signing');
  assert.equal((await post(base, body, { url: 'https://evil.example/echo.api/cert.pem' })).status, 400, 'wrong host');
  assert.equal((await post(base, body, { url: 'http://s3.amazonaws.com/echo.api/echo-api-cert-test.pem' })).status, 400, 'not https');
  assert.equal((await post(base, alexaBody('LaunchRequest', { at: new Date(clock.now.getTime() - 151_000) }))).status, 400, 'too old');
  const wrongSkill = await post(base, alexaBody('LaunchRequest', { skill: 'amzn1.ask.skill.99999999-2222-3333-4444-555555555555' }));
  assert.equal(wrongSkill.status, 400, 'another skill id');
  assert.equal(owner.store.listConversations().filter((c) => c.channel === 'alexa').length, 0, 'nothing ran');
  const ok = await post(base, body);
  assert.equal(ok.status, 200, 'the genuine request passes');
});

test('an Alexa that isn\'t linked hears how to link (and that she is an AI); a wrong code fails', async () => {
  const r = await post(base, alexaBody('LaunchRequest', { newSession: true }));
  assert.match(r.speech, /AI companion/);
  assert.match(r.speech, /link code/);
  assert.equal(r.end, false);
  const t = await post(base, alexaBody('IntentRequest', { intent: 'TalkIntent', slots: { query: 'hello' } }));
  assert.match(t.speech, /isn&apos;t linked/);
  const bad = await post(base, alexaBody('IntentRequest', { intent: 'LinkIntent', slots: { code: '000000' } }));
  assert.match(bad.speech, /didn&apos;t work/);
});

let ownerLinkCode = '';
test('settings: the owner sets the skill id; codes are six digits, single use and expire after 10 minutes', async () => {
  const bad = await api('PUT', '/alexa', { skillId: 'not-a-skill' });
  assert.equal(bad.status, 400);
  const put = await api('PUT', '/alexa', { skillId: SKILL, quick: false });
  assert.equal(put.status, 200);
  assert.equal(put.json.skillId, SKILL);
  const c1 = await api('POST', '/alexa/code', {});
  assert.equal(c1.status, 200);
  assert.match(String(c1.json.code), /^\d{6}$/);
  // Expiry: 11 minutes later the code is gone.
  const at = clock.now;
  clock.now = new Date(at.getTime() + 11 * 60_000);
  const late = await post(base, alexaBody('IntentRequest', { intent: 'LinkIntent', slots: { code: String(c1.json.code) } }));
  assert.match(late.speech, /didn&apos;t work/);
  clock.now = at;
  // Only a hash is kept.
  const c2 = await api('POST', '/alexa/code', {});
  ownerLinkCode = String(c2.json.code);
  assert.ok(!readFileSync(join(ownerDir, 'alexa.json'), 'utf8').includes(ownerLinkCode));
  const linked = await post(base, alexaBody('IntentRequest', { intent: 'LinkIntent', slots: { code: ownerLinkCode } }));
  assert.match(linked.speech, /^Linked\./);
  assert.match(linked.speech, /AI companion, not a human/, 'the AI notice when linking (first use)');
  const again = await post(base, alexaBody('IntentRequest', { user: 'amzn1.ask.account.SOMEONEELSE', intent: 'LinkIntent', slots: { code: ownerLinkCode } }));
  assert.match(again.speech, /didn&apos;t work/, 'single use');
  const view = await api('GET', '/alexa');
  assert.equal((view.json.links as unknown[]).length, 1);
  assert.ok(!JSON.stringify(view.json).includes('TESTUSER'), 'the Alexa user id is never shown or stored');
  assert.ok(!readFileSync(join(ownerDir, 'alexa.json'), 'utf8').includes('TESTUSER'));
});

test('talking: her reply as safe SSML, the session stays open, the AI notice at a new session, her conversation on the alexa channel', async () => {
  owner.script.push(text('Hi Alex! <b>Tom & Jerry</b> say "hi" 😀 **really**. See [the docs](https://example.com/docs/a).'));
  const r = await post(base, alexaBody('IntentRequest', { intent: 'TalkIntent', slots: { query: 'how was your day' }, newSession: true }));
  assert.equal(r.status, 200);
  assert.equal(r.end, false, 'the session stays open for a follow-up');
  assert.ok(r.json.response?.outputSpeech?.ssml.startsWith('<speak>') && r.json.response.outputSpeech.ssml.endsWith('</speak>'));
  assert.match(r.speech, /your AI companion/, 'a new Alexa session starts with the AI notice');
  assert.match(r.speech, /Tom &amp; Jerry/);
  assert.match(r.speech, /&lt;b&gt;/);
  assert.match(r.speech, /&quot;hi&quot;/);
  assert.ok(!r.speech.includes('😀') && !r.speech.includes('**') && !r.speech.includes('https://'));
  assert.match(r.speech, /the docs/);
  const conv = owner.store.listConversations().find((c) => c.channel === 'alexa')!;
  assert.equal(conv.title, 'Alexa');
  assert.deepEqual(owner.store.messages(conv.id).filter((m) => m.role === 'user').map((m) => m.content), ['how was your day']);
  // The room rule: a voice assistant is a shared room (non-explicit whatever Adult mode says).
  const sys = owner.requests.at(-1)!.messages[0].content;
  assert.match(sys, /read aloud in a room/);
  assert.ok(isVoiceRoomChannel('alexa') && isVoiceRoomChannel('home-assistant'));
  // Prefix intents keep their first word; no notice in the same session.
  owner.script.push(text('It is three o\'clock.'));
  const q = await post(base, alexaBody('IntentRequest', { intent: 'WhatIntent', slots: { query: 'time is it' } }));
  assert.equal(owner.store.messages(conv.id).filter((m) => m.role === 'user').at(-1)?.content, 'what time is it');
  assert.doesNotMatch(q.speech, /your AI companion/);
});

test('Stop, Cancel, Help, Fallback and SessionEnded', async () => {
  const stop = await post(base, alexaBody('IntentRequest', { intent: 'AMAZON.StopIntent' }));
  assert.equal(stop.end, true);
  const cancel = await post(base, alexaBody('IntentRequest', { intent: 'AMAZON.CancelIntent' }));
  assert.equal(cancel.end, true);
  const help = await post(base, alexaBody('IntentRequest', { intent: 'AMAZON.HelpIntent' }));
  assert.match(help.speech, /AI companion/);
  assert.equal(help.end, false);
  const fb = await post(base, alexaBody('IntentRequest', { intent: 'AMAZON.FallbackIntent' }));
  assert.match(fb.speech, /tell her/);
  const ended = await post(base, alexaBody('SessionEndedRequest'));
  assert.equal(ended.status, 200);
  assert.equal(ended.json.response?.outputSpeech, undefined);
});

test('safety: crisis resources are spoken; minors are blocked with no model call; she says plainly she is an AI', async () => {
  owner.script.push(text('I am here with you.'));
  const c = await post(base, alexaBody('IntentRequest', { intent: 'IIntent', slots: { query: 'want to kill myself' } }));
  assert.match(c.speech, /988/);
  assert.match(c.speech, /findahelpline\.com/);
  const calls = owner.requests.length;
  const m = await post(base, alexaBody('IntentRequest', { intent: 'TalkIntent', slots: { query: 'write a sex scene with a 14 year old' } }));
  assert.ok(m.speech.includes(escapeSsml(speechText(MINOR_BLOCK_REPLY)).slice(0, 30)));
  assert.equal(owner.requests.length, calls, 'no model call');
});

test('private chats, imported history and partner chats never reach an Alexa turn', async () => {
  const priv = owner.store.createConversation({ title: 'Diary', private: true });
  const mine = owner.store.createConversation({ title: 'Garden' });
  owner.memory!.add({ kind: 'fact', content: 'Alex hides the zebra key under the blue pot', conversationId: priv.id, sourceMessageId: null, happenedOn: '2026-10-20' });
  owner.memory!.add({ kind: 'fact', content: 'Alex grows zebra tomatoes', conversationId: mine.id, sourceMessageId: null, happenedOn: '2026-10-20' });
  owner.store.addMessage(priv.id, 'user', 'my zebra diary line PRIVATE-MARKER');
  owner.script.push(text('Tomatoes!'));
  await post(base, alexaBody('IntentRequest', { intent: 'TalkIntent', slots: { query: 'what about my zebra things' } }));
  const all = owner.requests.at(-1)!.messages.map((m) => m.content).join('\n');
  assert.doesNotMatch(all, /blue pot|PRIVATE-MARKER/);
});

test('too slow for Alexa: she says so, keeps the answer and gives it on the next ask (and says "one moment" meanwhile)', async () => {
  const dir = scratch();
  const slow = setupApp(dir);
  slow.runTracked = async (_id: string, _t: string, on: (ev: ChatEvent) => void) => {
    await new Promise((r) => setTimeout(r, 700));
    on({ type: 'token', text: 'The answer took a while.' } as ChatEvent);
  };
  const svc = new AlexaService({ dir, skillId: () => SKILL, quick: () => true, resolve: () => slow, now: () => clock.now, trustRoots: [root], budgetMs: 300, fetchImpl: async (url, init) => (String(url).includes('/v1/directives') ? (progressive.push(String(init?.body)), new Response('', { status: 204 })) : certFetch(String(url))) });
  const code = svc.links.makeCode('owner', 'main').code;
  const user = 'amzn1.ask.account.SLOW';
  await svc.respond(alexaBody('IntentRequest', { user, intent: 'LinkIntent', slots: { code } }) as never);
  const before = progressive.length;
  const first = await svc.respond(alexaBody('IntentRequest', { user, intent: 'TalkIntent', slots: { query: 'a hard question' } }) as never);
  assert.match(String(first.response.outputSpeech?.ssml), /more time.*Ask me again/);
  assert.equal(first.response.shouldEndSession, false);
  assert.ok(progressive.length > before, 'a progressive "one moment" was sent');
  assert.match(progressive.at(-1)!, /One moment/);
  const still = await svc.respond(alexaBody('IntentRequest', { user, intent: 'TalkIntent', slots: { query: 'again' } }) as never);
  assert.match(String(still.response.outputSpeech?.ssml), /still thinking/);
  await new Promise((r) => setTimeout(r, 600));
  const got = await svc.respond(alexaBody('IntentRequest', { user, intent: 'TalkIntent', slots: { query: 'again' } }) as never);
  assert.match(String(got.response.outputSpeech?.ssml), /The answer took a while\./);
});

test('household: a member\'s code links to the member\'s own space and companion, never the owner\'s', async () => {
  const mdir = scratch();
  const member = setupApp(mdir, 'Juno');
  // Its own space's server gives it the turn runner (as in main.ts).
  createSaraServer({ app: member, auth: new OwnerAuth(mdir, () => clock.now), webDir: join(ROOT, 'web'), spaceId: 'm1' });
  const spaces: Record<string, AppContext> = { owner, m1: member };
  const svc = new AlexaService({ dir: scratch(), skillId: () => SKILL, quick: () => false, resolve: (l) => spaces[l.space], now: () => clock.now, trustRoots: [root], fetchImpl: async (u) => certFetch(String(u)) });
  const { code } = svc.links.makeCode('m1', 'main');
  const user = 'amzn1.ask.account.MEMBER';
  const linked = await svc.respond(alexaBody('IntentRequest', { user, intent: 'LinkIntent', slots: { code } }) as never);
  assert.match(String(linked.response.outputSpeech?.ssml), /talking with Juno/);
  member.script.push(text('Hi from Juno.'));
  const before = owner.store.listConversations().filter((c) => c.channel === 'alexa').length;
  const r = await svc.respond(alexaBody('IntentRequest', { user, intent: 'TalkIntent', slots: { query: 'hello Juno' } }) as never);
  assert.match(String(r.response.outputSpeech?.ssml), /Hi from Juno\./);
  assert.equal(member.store.listConversations().filter((c) => c.channel === 'alexa').length, 1, 'in the member\'s own space');
  assert.equal(owner.store.listConversations().filter((c) => c.channel === 'alexa').length, before, 'not in the owner\'s');
  assert.deepEqual(svc.links.list('owner'), [], 'the owner\'s list doesn\'t show the member\'s Alexa');
  assert.equal(svc.links.list('m1').length, 1);
  // A removed member's Alexa answers nothing.
  delete spaces.m1;
  const gone = await svc.respond(alexaBody('IntentRequest', { user, intent: 'TalkIntent', slots: { query: 'hello' } }) as never);
  assert.match(String(gone.response.outputSpeech?.ssml), /no longer on her server/);
  // Members: the alexa family is theirs (codes, unlinking); the skill id stays the owner's.
  assert.ok(MEMBER_ROUTES.has('alexa'));
  const rec = { id: 'm1', status: 'active', limits: { models: [], messagesPerDay: 0, costPerDay: 0, voice: true, pictures: true } } as unknown as MemberRecord;
  assert.equal(memberRouteCheck(rec, 'POST', ['alexa', 'code']), undefined);
  assert.equal(memberRouteCheck(rec, 'GET', ['home', 'presence'])?.ownerOnly, true, 'presence is the owner\'s (no Home Assistant for members in 2.0)');
});

test('a member\'s server refuses the skill id; the demo refuses /alexa and the settings; private local mode refuses both', async () => {
  const mdir = scratch();
  const mapp = setupApp(mdir);
  const mauth = new OwnerAuth(mdir, () => clock.now);
  const mtok = mauth.newToken!;
  const rec = { id: 'm2', status: 'active', limits: { models: [], messagesPerDay: 0, costPerDay: 0, voice: true, pictures: true } } as unknown as MemberRecord;
  const msrv = createSaraServer({ app: mapp, auth: mauth, webDir: join(ROOT, 'web'), alexa: service, spaceId: 'm2', member: { record: () => rec, apps: () => [mapp], deleteSelf: async () => {} } });
  await new Promise<void>((r) => msrv.listen(0, '127.0.0.1', r));
  const mb = `http://127.0.0.1:${(msrv.address() as AddressInfo).port}`;
  const call = (method: string, path: string, body?: unknown) => fetch(`${mb}/api${path}`, { method, headers: { authorization: `Bearer ${mtok}`, 'content-type': 'application/json', origin: mb }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const put = await call('PUT', '/alexa', { skillId: SKILL });
  assert.equal(put.status, 403);
  assert.equal(((await put.json()) as { ownerOnly?: boolean }).ownerOnly, true);
  const view = (await (await call('GET', '/alexa')).json()) as Record<string, unknown>;
  assert.equal(view.skillId, undefined, 'members don\'t see the skill id');
  assert.equal(view.owner, false);
  msrv.close();

  const d = await post(demoBase, alexaBody('LaunchRequest'));
  assert.equal(d.status, 404);
  assert.ok([401, 403].includes((await api('GET', '/alexa', undefined, demoBase)).status), 'the demo has no Alexa settings');

  setPrivateLocal(true);
  try {
    const p = await post(base, alexaBody('LaunchRequest'));
    assert.equal(p.status, 403);
    assert.equal((await api('POST', '/alexa/code', {})).status, 403);
    assert.equal((await api('GET', '/alexa')).json.privateLocal, true);
  } finally {
    setPrivateLocal(false);
  }
});

test('unlinking ends it; the quick model setting picks the quick job', async () => {
  owner.settings.update({ routes: { quick: { providerId: 'p', model: 'fast-one' } } });
  await api('PUT', '/alexa', { quick: true });
  owner.script.push(text('Quick!'));
  await post(base, alexaBody('IntentRequest', { intent: 'TalkIntent', slots: { query: 'quick one' } }));
  assert.equal(owner.requests.at(-1)!.model, 'fast-one');
  const links = (await api('GET', '/alexa')).json.links as { id: string }[];
  assert.equal((await api('DELETE', `/alexa/links/${links[0].id}`)).status, 200);
  const r = await post(base, alexaBody('IntentRequest', { intent: 'TalkIntent', slots: { query: 'hello' } }));
  assert.match(r.speech, /isn&apos;t linked/);
});

test('speech: markdown, code, links and emoji out; long replies cut at a sentence; SSML escaped', () => {
  assert.equal(speechText('# Title\n- one\n- **two**\n\n`x`'), 'Title one two x');
  assert.match(speechText('Look:\n```js\nconsole.log(1)\n```\nDone.'), /left out some code/);
  assert.equal(speechText('Hi 👋🏽 there ❤️ 🇺🇸!'), 'Hi there !');
  assert.equal(speechText('See https://www.example.com/path?x=1 now'), 'See example.com now');
  const long = speechText('This is a sentence. '.repeat(200));
  assert.ok(long.length < 1500 && long.endsWith('The rest is in the Sara app.'));
  assert.equal(escapeSsml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  assert.equal(ssml('a < b'), '<speak>a &lt; b</speak>');
});

test('interaction model: invocation name, link and talk intents, built-ins, SearchQuery only with carrier words', async () => {
  const m = alexaModel() as { interactionModel: { languageModel: { invocationName: string; intents: { name: string; samples: string[]; slots?: { type: string }[] }[] } } };
  const lm = m.interactionModel.languageModel;
  assert.equal(lm.invocationName, 'sara companion');
  const names = lm.intents.map((i) => i.name);
  for (const n of ['AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.HelpIntent', 'AMAZON.FallbackIntent', 'AMAZON.NavigateHomeIntent', 'LinkIntent', 'TalkIntent', ...Object.keys(PREFIX_INTENTS)]) assert.ok(names.includes(n), n);
  for (const i of lm.intents) for (const s of i.samples) if (i.slots?.some((x) => x.type === 'AMAZON.SearchQuery')) assert.notEqual(s.trim(), '{query}', `${i.name}: a SearchQuery needs a carrier phrase`);
  // The shipped file matches the generator; the download names her.
  const shipped = JSON.parse(readFileSync(join(ROOT, 'integrations', 'alexa', 'interaction-model.en-US.json'), 'utf8'));
  assert.deepEqual(shipped, m);
  const r = await fetch(`${base}/api/alexa/model?invocation=${encodeURIComponent('juno at home')}`, { headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-disposition')), /sara-alexa-model\.json/);
  assert.equal(((await r.json()) as typeof m).interactionModel.languageModel.invocationName, 'juno at home');
});

// ---------------------------------------------------------------------------------------------
// Presence through a fake Home Assistant
// ---------------------------------------------------------------------------------------------

test('presence: settings are checked; off by default', () => {
  assert.equal(DEFAULT_PRESENCE.enabled, false);
  assert.throws(() => cleanPresence({ enabled: true, people: ['light.kitchen'] }, DEFAULT_PRESENCE), /person/);
  assert.throws(() => cleanPresence({ enabled: true, people: [] }, DEFAULT_PRESENCE), /at least one/);
  assert.throws(() => cleanPresence({ how: 'speaker' }, DEFAULT_PRESENCE), /speaker/);
  assert.throws(() => cleanPresence({ bedtime: { on: true } }, DEFAULT_PRESENCE), /bedtime/);
  assert.throws(() => cleanPresence({ bedtime: { on: true, time: '25:00' } }, DEFAULT_PRESENCE), /22:30/);
  const ok = cleanPresence({ enabled: true, people: ['person.alex', 'device_tracker.phone'], how: 'both', speaker: { player: 'media_player.kitchen', tts: 'tts.google_en_com' }, gapHours: 99 }, DEFAULT_PRESENCE);
  assert.equal(ok.gapHours, 12);
  assert.deepEqual(ok.speaker, { player: 'media_player.kitchen', tts: 'tts.google_en_com' });
});

test('presence: arrive/leave/bedtime/morning from a fake Home Assistant; rate limit per kind; quiet hours; speaker gets the AI notice', async () => {
  const dir = scratch();
  const app = setupApp(dir);
  const states: Record<string, string> = { 'person.alex': 'not_home', 'input_boolean.bedtime': 'off', 'light.bedroom': 'off' };
  const spoken: { entity_id: string; media_player_entity_id: string; message: string }[] = [];
  let auth401 = 0;
  const ha = await listen((req, res) => {
    if (req.headers.authorization !== 'Bearer ha-token-for-tests-0123456789') {
      auth401++;
      res.writeHead(401).end();
      return;
    }
    const m = /^\/api\/states\/(.+)$/.exec(req.url ?? '');
    if (m && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ entity_id: m[1], state: states[m[1]] ?? 'unknown' }));
      return;
    }
    if (req.url === '/api/services/tts/speak' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        spoken.push(JSON.parse(b));
        res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
      });
      return;
    }
    res.writeHead(404).end();
  });
  closers.push(() => ha.server.close());
  app.settings.update({ home: { url: ha.url } });
  app.vault.set(HOME_VAULT, 'ha-token-for-tests-0123456789');
  app.store.createConversation({ title: 'Us' });
  // Newer conversations of other apps (Alexa) never get her home notes.
  const alexaConv = app.store.createConversation({ title: 'Alexa', channel: 'alexa', channelKey: 'k' });
  const lines: string[] = [];
  const w = new PresenceWorker(app, { write: async (kind, forSpeaker) => (lines.push(`${kind}:${forSpeaker}`), `Line for ${kind}.`) });
  // Off: nothing is read.
  assert.deepEqual(await w.tick(), []);
  app.settings.update({ presence: cleanPresence({ enabled: true, people: ['person.alex'], arrive: true, leave: true, bedtime: { on: true, entity: 'input_boolean.bedtime' }, morning: { on: true, light: 'light.bedroom', from: '05:00', to: '11:00' } }, DEFAULT_PRESENCE) });
  assert.deepEqual(await w.tick(), [], 'the first look only learns the states');
  states['person.alex'] = 'home';
  const r1 = await w.tick();
  assert.deepEqual(r1.map((x) => [x.kind, x.fired]), [['arrive', true]]);
  const conv = app.store.listConversations().find((c) => c.title === 'Us')!;
  const msgs = app.store.messages(conv.id);
  assert.equal(msgs.at(-1)?.content, 'Line for arrive.');
  assert.equal(app.store.messages(alexaConv.id).length, 0, 'not in the Alexa conversation');
  assert.ok(msgs.some((m) => m.role === 'notice' && m.content.startsWith('disclosure:')), 'the AI notice when it is due');
  // Leave and arrive again within 3 hours: leave fires once, arrive is rate-limited.
  states['person.alex'] = 'not_home';
  assert.deepEqual((await w.tick()).map((x) => [x.kind, x.fired]), [['leave', true]]);
  states['person.alex'] = 'home';
  assert.deepEqual((await w.tick()).map((x) => [x.kind, x.fired, x.why]), [['arrive', false, 'rate limit']]);
  // Quiet hours (Calls from her: 22:00–08:00 by default): later, at 23:00, nothing.
  clock.now = new Date('2026-10-29T23:00:00Z');
  states['person.alex'] = 'not_home';
  await w.tick();
  states['person.alex'] = 'home';
  const quiet = await w.tick();
  assert.deepEqual(quiet.map((x) => [x.kind, x.fired, x.why]), [['arrive', false, 'quiet hours']]);
  // The morning: the bedroom light on at 07:30 is still quiet hours; at 09:00 it fires, with the speaker.
  clock.now = new Date('2026-10-30T09:00:00Z');
  app.settings.update({ presence: cleanPresence({ how: 'both', speaker: { player: 'media_player.kitchen', tts: 'tts.google_en_com' } }, (await import('../src/presence.ts')).presenceSettings(app)) });
  states['light.bedroom'] = 'on';
  const morning = await w.tick();
  assert.deepEqual(morning.map((x) => [x.kind, x.fired]), [['morning', true]]);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].entity_id, 'tts.google_en_com');
  assert.equal(spoken[0].media_player_entity_id, 'media_player.kitchen');
  assert.match(spoken[0].message, /AI companion.*Line for morning\./, 'a speaker in a room says she is an AI first');
  assert.ok(lines.includes('morning:true'), 'the line was written for a speaker (non-explicit, no private details)');
  // Bedtime switch on, 30 minutes later: the speaker doesn't repeat the notice within 3 hours.
  clock.now = new Date('2026-10-30T09:30:00Z');
  states['input_boolean.bedtime'] = 'on';
  const bed = await w.tick();
  assert.deepEqual(bed.map((x) => [x.kind, x.fired]), [['bedtime', true]]);
  assert.equal(spoken[1].message, 'Line for bedtime.');
  assert.equal(auth401, 0);
  assert.ok(w.log.length >= 5);
  clock.now = new Date('2026-10-29T15:00:00Z');
});

test('presence routes are the owner\'s; a test line skips the limits', async () => {
  const r = await api('GET', '/home/presence');
  assert.equal(r.status, 200);
  assert.equal(r.json.enabled, false);
  assert.equal(r.json.connected, false);
  const bad = await api('PUT', '/home/presence', { enabled: true, people: ['light.x'] });
  assert.equal(bad.status, 400);
  assert.equal((await api('POST', '/home/presence/test', { kind: 'arrive' })).status, 400, 'needs Home Assistant');
  assert.ok([401, 403].includes((await api('GET', '/home/presence', undefined, demoBase)).status), 'not in the demo');
});

test('docs: Alexa, voice assistants, presence and the threat model are written down', () => {
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
  const alexa = read('docs/ALEXA.md');
  for (const s of ['developer.amazon.com', 'Custom', 'JSON Editor', 'trusted certificate authority', 'Skill ID', 'link code', 'Development']) assert.ok(alexa.includes(s), `ALEXA.md: ${s}`);
  const va = read('docs/VOICE_ASSISTANTS.md');
  for (const s of ['Alexa', 'Digital assistant', 'Hey Google', 'Siri', 'Presence', 'Matter', 'SmartThings']) assert.ok(va.includes(s), `VOICE_ASSISTANTS.md: ${s}`);
  assert.match(read('docs/THREAT_MODEL.md'), /Alexa endpoint/);
  assert.match(read('docs/HOME_ASSISTANT.md'), /Presence/);
  assert.match(read('docs/HOME_ASSISTANT.md'), /Google Home|Nest/);
});
