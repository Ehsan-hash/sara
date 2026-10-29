// Single-owner authentication. A random owner token is generated on first start and shown once
// in the server log; only its hash is stored. Browser sessions use an HMAC-signed cookie.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp.ts';
import type { StoredPasskey } from './webauthn.ts';

const FILE = 'owner.json';
export const SESSION_COOKIE = 'sara_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A device token (terminal, VS Code) ends 90 days after approval even when used every day. */
export const DEVICE_TOKEN_MAX_MS = 90 * 24 * 60 * 60 * 1000;

interface DeviceSession {
  id: string;
  label: string;
  createdAt: string;
  lastSeen: string;
  /** Phase 52: an app signed in with the device code (terminal, VS Code): its token's hash. */
  tokenHash?: string;
  /**
   * Phase 57: 'api' = an API key the owner made for another app (SillyTavern, Open WebUI, Claude
   * Desktop…). It only works on /v1 (OpenAI-compatible) and /mcp, never on the app's own /api,
   * and lasts until the owner removes it under Devices.
   * Hardening M4: 'home-assistant' = the Home Assistant integration's device token: it may only talk
   * with her in the conversations it made itself (no other conversation, memory, file or setting).
   */
  kind?: 'api' | 'home-assistant';
}

interface OwnerFile {
  tokenHash: string;
  sessionSecret: string;
  /** Signed-in devices; a session cookie only works while its device is listed. */
  sessions?: DeviceSession[];
  /** Upgraded from a version without the device list: earlier cookies are added as they show up. */
  legacy?: boolean;
  /** Phase 24: passkeys (WebAuthn) that can sign in. */
  passkeys?: StoredPasskey[];
  /** Phase 24: two-step sign-in (authenticator app). `pending` until the first code is confirmed. */
  totp?: { secret: string; enabledAt: string | null; lastCounter: number };
  /**
   * Phase 59: set on a brand-new server until the owner first signs in (or claims it in the
   * browser, src/claim.ts). Owner files from before Phase 59, and every token reset, don't have it,
   * so browser setup never reopens on a server that already has an owner.
   */
  setupPending?: true;
}

export interface DeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSeen: string;
  /** Phase 52: 'app' = signed in with a device code and a token (terminal, VS Code). Phase 57: 'api' = an API key for another app. M4: 'home-assistant'. */
  kind: 'browser' | 'app' | 'api' | 'home-assistant';
}

/** Hardening L4: browser and app sign-ins kept at most (API keys are capped on their own, at 20). */
export const MAX_SESSIONS = 50;
/** Keeps every API key and the newest MAX_SESSIONS other sign-ins (a pile of old sign-ins never drops a key). */
function capSessions(list: DeviceSession[]): DeviceSession[] {
  const others = list.filter((d) => d.kind !== 'api');
  const drop = new Set(others.slice(0, Math.max(0, others.length - MAX_SESSIONS)));
  return list.filter((d) => !drop.has(d));
}

/** Phase 52: device tokens look like `sara_dev.<device id>.<secret>`. */
export const DEVICE_TOKEN_PREFIX = 'sara_dev.';

/** "Chrome on Windows", "Safari on iPhone"… from a User-Agent header. */
export function deviceLabel(ua = ''): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /\bSaraPhone\/\d/.test(ua) ? 'Sara app' : /\bSaraDesktop\/\d/.test(ua) ? 'Sara app' : /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|python/i.test(ua) ? 'Script' : 'Browser';
  return os ? `${browser} on ${os}` : browser;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class OwnerAuth {
  readonly #path: string;
  #owner: OwnerFile;
  readonly #now: () => Date;
  /** Set only when a new token was generated during this process start. */
  readonly newToken: string | undefined;
  #fresh = false;
  /** Phase 71: a member's tokens start with `sara_m.<member id>.` (the owner's have no prefix). */
  readonly #prefix: string;

  constructor(dataDir: string, now: () => Date = () => new Date(), opts: { tokenPrefix?: string } = {}) {
    this.#path = join(dataDir, FILE);
    this.#now = now;
    this.#prefix = opts.tokenPrefix ?? '';
    if (existsSync(this.#path)) {
      this.#owner = JSON.parse(readFileSync(this.#path, 'utf8')) as OwnerFile;
      if (!this.#owner.sessions) {
        this.#owner.sessions = [];
        this.#owner.legacy = true;
        this.#save();
      }
    } else {
      const { owner, token } = OwnerAuth.#generate(this.#prefix);
      this.#owner = owner;
      this.newToken = token;
      this.#fresh = true;
      this.#save();
    }
  }

  /** Phase 59: a new server nobody has signed in to yet (browser setup may be open, src/claim.ts). */
  get setupPending(): boolean {
    return this.#owner.setupPending === true;
  }

  /** Phase 59: the owner signed in for the first time: browser setup closes for good. */
  markSignedIn(): void {
    if (!this.#owner.setupPending) return;
    delete this.#owner.setupPending;
    this.#save();
  }

  static #generate(prefix = ''): { owner: OwnerFile; token: string } {
    const token = `${prefix}${randomBytes(24).toString('base64url')}`;
    return { token, owner: { tokenHash: sha256(token), sessionSecret: randomBytes(32).toString('base64url'), sessions: [] } };
  }

  #save(): void {
    if (this.#fresh) {
      // Phase 59: only the very first owner file of a server waits for its owner (see setupPending).
      this.#owner.setupPending = true;
      this.#fresh = false;
    }
    writeFileSync(this.#path, JSON.stringify(this.#owner, null, 2) + '\n', { mode: 0o600 });
  }

  /**
   * Replaces the owner token (and invalidates all sessions). Returns the new token. Passkeys and
   * two-step sign-in stay, unless `clearSecurity` (the server-side recovery: `sara reset-token`).
   */
  resetToken(opts: { clearSecurity?: boolean } = {}): string {
    const { owner, token } = OwnerAuth.#generate(this.#prefix);
    if (!opts.clearSecurity) {
      if (this.#owner.passkeys) owner.passkeys = this.#owner.passkeys;
      if (this.#owner.totp) owner.totp = this.#owner.totp;
    }
    this.#owner = owner;
    this.#save();
    return token;
  }

  // ---------- Phase 24: passkeys ----------

  passkeys(): Omit<StoredPasskey, 'jwk'>[] {
    return (this.#owner.passkeys ?? []).map(({ jwk: _k, ...p }) => ({ ...p }));
  }

  passkey(id: string): StoredPasskey | undefined {
    return this.#owner.passkeys?.find((p) => p.id === id);
  }

  addPasskey(p: Omit<StoredPasskey, 'createdAt' | 'lastUsedAt'>): void {
    const list = (this.#owner.passkeys ??= []);
    if (list.some((x) => x.id === p.id)) throw new Error('That passkey is already added.');
    if (list.length >= 20) throw new Error('Up to 20 passkeys: remove one first.');
    list.push({ ...p, label: p.label.slice(0, 60) || 'Passkey', createdAt: this.#now().toISOString(), lastUsedAt: null });
    this.#save();
  }

  usedPasskey(id: string, signCount: number): void {
    const p = this.passkey(id);
    if (!p) return;
    p.signCount = signCount;
    p.lastUsedAt = this.#now().toISOString();
    this.#save();
  }

  removePasskey(id: string): boolean {
    const before = this.#owner.passkeys?.length ?? 0;
    this.#owner.passkeys = (this.#owner.passkeys ?? []).filter((p) => p.id !== id);
    this.#save();
    return this.#owner.passkeys.length < before;
  }

  // ---------- Phase 24: two-step sign-in ----------

  get twoStepOn(): boolean {
    return Boolean(this.#owner.totp?.enabledAt);
  }

  /** Starts setting up two-step sign-in: a new secret to add to an authenticator app. */
  startTwoStep(account: string): { secret: string; url: string } {
    if (this.twoStepOn) throw new Error('Two-step sign-in is already on.');
    const secret = newTotpSecret();
    this.#owner.totp = { secret, enabledAt: null, lastCounter: -1 };
    this.#save();
    return { secret, url: otpauthUrl(secret, account) };
  }

  /** Checks a code; when setting up, the first right code turns it on. */
  checkTwoStep(code: string): boolean {
    const t = this.#owner.totp;
    if (!t) return false;
    const k = verifyTotp(t.secret, code, this.#now().getTime(), t.lastCounter);
    if (k === undefined) return false;
    t.lastCounter = k; // each code works once
    t.enabledAt ??= this.#now().toISOString();
    this.#save();
    return true;
  }

  /** Turns two-step sign-in off (needs a current code when it's on). */
  stopTwoStep(code: string): void {
    if (this.twoStepOn && !this.checkTwoStep(code)) throw new Error('That code is wrong. Use the current code from your authenticator app.');
    delete this.#owner.totp;
    this.#save();
  }

  /** New owner token from the app: the current one must be given; all devices are signed out. */
  rotateToken(current: string, opts: { clearPasskeys?: boolean } = {}): string {
    if (!this.verifyToken(current)) throw new Error('That is not the current owner token.');
    const passkeys = this.#owner.passkeys;
    const token = this.resetToken();
    // A new token is for "someone may have had access": passkeys go too unless asked to keep them.
    if (opts.clearPasskeys !== false) delete this.#owner.passkeys;
    else if (passkeys) this.#owner.passkeys = passkeys;
    this.#save();
    return token;
  }

  verifyToken(token: string): boolean {
    return typeof token === 'string' && token.length > 0 && safeEqual(sha256(token), this.#owner.tokenHash);
  }

  #sign(payload: string): string {
    return createHmac('sha256', this.#owner.sessionSecret).update(payload).digest('base64url');
  }

  createSession(label = 'Browser'): { value: string; maxAgeSeconds: number; id: string } {
    const now = this.#now();
    const expires = now.getTime() + SESSION_TTL_MS;
    const id = randomBytes(9).toString('base64url');
    const payload = `${expires}.${id}`;
    const sessions = (this.#owner.sessions ?? []).filter((d) => d.kind === 'api' || Date.parse(d.lastSeen) > now.getTime() - SESSION_TTL_MS);
    sessions.push({ id, label: label.slice(0, 60), createdAt: now.toISOString(), lastSeen: now.toISOString() });
    this.#owner.sessions = capSessions(sessions);
    this.#save();
    return { value: `${payload}.${this.#sign(payload)}`, maxAgeSeconds: SESSION_TTL_MS / 1000, id };
  }

  /** The device id of a valid session cookie, or undefined. */
  sessionId(value: string | undefined, label = 'Earlier sign-in'): string | undefined {
    if (!value) return undefined;
    const i = value.lastIndexOf('.');
    if (i < 0) return undefined;
    const payload = value.slice(0, i);
    if (!safeEqual(this.#sign(payload), value.slice(i + 1))) return undefined;
    const [exp, id] = payload.split('.');
    const expires = Number(exp);
    const now = this.#now();
    if (!Number.isFinite(expires) || expires <= now.getTime() || !id) return undefined;
    const sessions = (this.#owner.sessions ??= []);
    let d = sessions.find((x) => x.id === id);
    if (!d) {
      if (!this.#owner.legacy) return undefined; // signed out
      d = { id, label, createdAt: now.toISOString(), lastSeen: now.toISOString() };
      sessions.push(d);
      this.#save();
    } else if (now.getTime() - Date.parse(d.lastSeen) > 60 * 60 * 1000) {
      d.lastSeen = now.toISOString();
      this.#save();
    }
    return id;
  }

  verifySession(value: string | undefined): boolean {
    return this.sessionId(value) !== undefined;
  }

  devices(): DeviceView[] {
    return [...(this.#owner.sessions ?? [])].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).map(({ tokenHash, kind, ...d }) => ({ ...d, kind: kind === 'api' || kind === 'home-assistant' ? kind : tokenHash ? 'app' : 'browser' }));
  }

  /**
   * Phase 52: a token for an app the owner approved with a device code. It is listed with the
   * other devices (and stops working when signed out there). Only its hash is kept.
   */
  createDeviceToken(label: string, kind?: 'api' | 'home-assistant'): { token: string; id: string } {
    const now = this.#now();
    const id = randomBytes(9).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const sessions = (this.#owner.sessions ?? []).filter((d) => d.kind === 'api' || Date.parse(d.lastSeen) > now.getTime() - SESSION_TTL_MS);
    if (kind === 'api' && sessions.filter((d) => d.kind === 'api').length >= 20) throw new Error('Up to 20 API keys: remove one you no longer use first (Devices and sign-in).');
    sessions.push({ id, label: label.slice(0, 60) || (kind === 'api' ? 'Another app' : 'App'), createdAt: now.toISOString(), lastSeen: now.toISOString(), tokenHash: sha256(secret), ...(kind ? { kind } : {}) });
    this.#owner.sessions = capSessions(sessions);
    this.#save();
    return { token: `${DEVICE_TOKEN_PREFIX}${id}.${secret}`, id };
  }

  /** Phase 57: an API key for another app (an OpenAI-compatible app or an MCP app). Shown once. */
  createApiKey(label: string): { token: string; id: string } {
    return this.createDeviceToken(label, 'api');
  }

  /** Phase 57: 'api' for an API key, 'app' for a device-code app, 'home-assistant' (M4), undefined for anything else. */
  deviceKind(id: string): 'api' | 'app' | 'home-assistant' | undefined {
    const d = this.#owner.sessions?.find((x) => x.id === id);
    return !d?.tokenHash ? undefined : d.kind === 'api' || d.kind === 'home-assistant' ? d.kind : 'app';
  }

  /** Phase 71: whether a device or app sign-in with this id is listed here (routing only; tokens are still checked). */
  hasDevice(id: string): boolean {
    return Boolean(this.#owner.sessions?.some((x) => x.id === id));
  }

  /** Phase 57: the label of a signed-in device or API key. */
  deviceLabelOf(id: string): string | undefined {
    return this.#owner.sessions?.find((x) => x.id === id)?.label;
  }

  /**
   * The device id of a valid device token, or undefined. Unused for 30 days = signed out; and in any
   * case 90 days after it was approved (the app then asks to be approved again).
   */
  deviceTokenId(token: string | undefined): string | undefined {
    if (!token?.startsWith(DEVICE_TOKEN_PREFIX)) return undefined;
    const [id, secret] = token.slice(DEVICE_TOKEN_PREFIX.length).split('.');
    if (!id || !secret) return undefined;
    const d = this.#owner.sessions?.find((x) => x.id === id);
    if (!d?.tokenHash || !safeEqual(sha256(secret), d.tokenHash)) return undefined;
    const now = this.#now().getTime();
    // Phase 57: an API key works until the owner removes it (it can only reach /v1 and /mcp).
    if (d.kind !== 'api') {
      if (Date.parse(d.lastSeen) < now - SESSION_TTL_MS) return undefined;
      if (!(Date.parse(d.createdAt) > now - DEVICE_TOKEN_MAX_MS)) return undefined;
    }
    if (now - Date.parse(d.lastSeen) > 60 * 60 * 1000) {
      d.lastSeen = new Date(now).toISOString();
      this.#save();
    }
    return id;
  }

  /** Signs out one device (or every device except `keepId`). */
  signOut(id: string | 'others', keepId?: string): number {
    const before = this.#owner.sessions?.length ?? 0;
    this.#owner.sessions = (this.#owner.sessions ?? []).filter((d) => (id === 'others' ? d.id === keepId : d.id !== id));
    this.#owner.legacy = false; // after an explicit sign-out, unknown cookies no longer get in
    this.#save();
    return before - this.#owner.sessions.length;
  }
}

/** Simple in-memory brute-force limiter for the login endpoint. */
export class LoginLimiter {
  readonly #failures = new Map<string, { at: number; w: number }[]>();
  readonly #max: number;
  readonly #windowMs: number;

  constructor(max = 10, windowMs = 15 * 60 * 1000) {
    this.#max = max;
    this.#windowMs = windowMs;
  }

  #sweptAt = 0;

  /** IPv6 addresses count per /64 (one home or one server usually has a whole /64). */
  static key(ip: string): string {
    if (!ip.includes(':') || /^::ffff:\d/.test(ip)) return ip.replace(/^::ffff:/, '');
    const [head, tail = ''] = ip.toLowerCase().split('::');
    const h = head ? head.split(':') : [];
    const t = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
    return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
  }

  #recent(ip: string, now: number): { at: number; w: number }[] {
    if (now - this.#sweptAt > this.#windowMs) {
      this.#sweptAt = now;
      for (const [k, v] of this.#failures) if (!v.some((f) => now - f.at < this.#windowMs)) this.#failures.delete(k);
    }
    return (this.#failures.get(LoginLimiter.key(ip)) ?? []).filter((f) => now - f.at < this.#windowMs);
  }

  blocked(ip: string, now = Date.now()): boolean {
    return this.#recent(ip, now).reduce((n, f) => n + f.w, 0) >= this.#max;
  }

  /** Counts a failure (weight 1; cheap requests like asking for a passkey challenge count less). */
  fail(ip: string, now = Date.now(), weight = 1): void {
    const list = this.#recent(ip, now);
    list.push({ at: now, w: weight });
    this.#failures.set(LoginLimiter.key(ip), list.slice(-200));
  }

  reset(ip: string): void {
    this.#failures.delete(LoginLimiter.key(ip));
  }
}
