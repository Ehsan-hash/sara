// Phase 24: passkeys (WebAuthn) and two-step sign-in, tested with a software authenticator that
// makes real keys and real signatures.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { LoginLimiter, OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { base32Decode, base32Encode, hotp, totpCounter, verifyTotp } from '../src/totp.ts';
import { decodeCbor, verifyAssertion, verifyRegistration } from '../src/webauthn.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

// ---------- a tiny CBOR encoder and a software authenticator ----------
type V = number | string | Buffer | V[] | Map<V, V>;
function cbor(v: V): Buffer {
  const head = (major: number, n: number) =>
    n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : n < 65536 ? Buffer.from([(major << 5) | 25, n >> 8, n & 255]) : Buffer.concat([Buffer.from([(major << 5) | 26]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; })()]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

class SoftAuthenticator {
  readonly credId = randomBytes(16);
  readonly key: { privateKey: KeyObject; publicKey: KeyObject };
  counter = 0;
  readonly kind: 'es256' | 'ed25519';
  constructor(kind: 'es256' | 'ed25519' = 'es256') {
    this.kind = kind;
    this.key = kind === 'es256' ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('ed25519');
  }
  cose(): Map<V, V> {
    const j = this.key.publicKey.export({ format: 'jwk' }) as { x: string; y?: string };
    return this.kind === 'es256'
      ? new Map<V, V>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x, 'base64url')], [-3, Buffer.from(j.y!, 'base64url')]])
      : new Map<V, V>([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(j.x, 'base64url')]]);
  }
  #authData(rpId: string, flags: number, extra = Buffer.alloc(0)) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), c, extra]);
  }
  create(o: { challenge: string; rpId: string; origin: string; flags?: number }) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: o.challenge, origin: o.origin }));
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credId.length);
    const authData = this.#authData(o.rpId, o.flags ?? 0x45, Buffer.concat([Buffer.alloc(16), len, this.credId, cbor(this.cose())]));
    return { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: cbor(new Map<V, V>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])).toString('base64url') };
  }
  get(o: { challenge: string; rpId: string; origin: string; flags?: number; type?: string; bump?: number }) {
    this.counter += o.bump ?? 1;
    const clientData = Buffer.from(JSON.stringify({ type: o.type ?? 'webauthn.get', challenge: o.challenge, origin: o.origin }));
    const authData = this.#authData(o.rpId, o.flags ?? 0x05);
    const data = Buffer.concat([authData, sha256(clientData)]);
    const signature = this.kind === 'es256' ? sign('sha256', data, this.key.privateKey) : sign(null, data, this.key.privateKey);
    return { id: this.credId.toString('base64url'), clientDataJSON: clientData.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url') };
  }
}

test('TOTP matches the RFC 6238 test vectors; each code works once; base32 round-trips', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(hotp(secret, totpCounter(59_000)), '287082');
  assert.equal(hotp(secret, totpCounter(1_111_111_109_000)), '081804');
  assert.equal(hotp(secret, totpCounter(2_000_000_000_000)), '279037');
  assert.deepEqual(base32Decode(base32Encode(Buffer.from([1, 2, 3, 250]))), Buffer.from([1, 2, 3, 250]));
  const at = 1_111_111_109_000;
  const k = verifyTotp(secret, '081804', at);
  assert.equal(k, totpCounter(at));
  assert.equal(verifyTotp(secret, '081804', at, k), undefined, 'used once');
  assert.equal(verifyTotp(secret, hotp(secret, totpCounter(at) - 1), at), totpCounter(at) - 1, '30 s of clock drift is fine');
  assert.equal(verifyTotp(secret, hotp(secret, totpCounter(at) - 3), at), undefined);
  assert.equal(verifyTotp(secret, '12345', at), undefined);
});

test('WebAuthn: registration and sign-in checks (ES256 and Ed25519), and what gets refused', () => {
  const site = { rpId: 'sara.example.com', origin: 'https://sara.example.com' };
  for (const kind of ['es256', 'ed25519'] as const) {
    const a = new SoftAuthenticator(kind);
    const reg = verifyRegistration(a.create({ challenge: 'c1', ...site }), { challenge: 'c1', ...site });
    assert.equal(reg.id, a.credId.toString('base64url'));
    const stored = { ...reg, label: 'x', createdAt: '', lastUsedAt: null };
    const count = verifyAssertion(a.get({ challenge: 'c2', ...site }), stored, { challenge: 'c2', ...site });
    assert.equal(count, 1);
    stored.signCount = count;
    // Wrong challenge, origin, site, type; missing user verification; a copied key (counter back).
    assert.throws(() => verifyAssertion(a.get({ challenge: 'old', ...site }), stored, { challenge: 'c3', ...site }), /expired/);
    assert.throws(() => verifyAssertion(a.get({ challenge: 'c3', ...site, origin: 'https://evil.example' }), stored, { challenge: 'c3', ...site }), /came from https:\/\/evil/);
    assert.throws(() => verifyAssertion(a.get({ challenge: 'c3', ...site, rpId: 'evil.example' }), stored, { challenge: 'c3', ...site }), /another site/);
    assert.throws(() => verifyAssertion(a.get({ challenge: 'c3', ...site, type: 'webauthn.create' }), stored, { challenge: 'c3', ...site }), /Wrong kind/);
    assert.throws(() => verifyAssertion(a.get({ challenge: 'c3', ...site, flags: 0x01 }), stored, { challenge: 'c3', ...site }), /fingerprint, face or PIN/);
    a.counter = 0;
    assert.throws(() => verifyAssertion(a.get({ challenge: 'c3', ...site, bump: 0 }), { ...stored, signCount: 5 }, { challenge: 'c3', ...site }), /copied/);
    // A signature from another key.
    const b = new SoftAuthenticator(kind);
    assert.throws(() => verifyAssertion({ ...b.get({ challenge: 'c4', ...site, bump: 10 }), id: reg.id }, stored, { challenge: 'c4', ...site }), /signature is wrong/);
  }
  const a = new SoftAuthenticator();
  assert.throws(() => verifyRegistration(a.create({ challenge: 'c', ...site, flags: 0x41 }), { challenge: 'c', ...site }), /fingerprint, face or PIN/);
  assert.throws(() => verifyRegistration(a.create({ challenge: 'c', ...site, rpId: 'other.example' }), { challenge: 'c', ...site }), /another site/);
  // The CBOR reader refuses junk without throwing anything odd.
  assert.throws(() => decodeCbor(Buffer.from([0x5f])), /indefinite/);
  assert.throws(() => decodeCbor(Buffer.from([0x45, 1, 2])), /truncated/);
});

// ---------- through the server ----------
const { dir, cleanup } = tempDir();
const clock = { now: new Date() };
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') } as never);
let base = '';
let origin = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, 'localhost', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  origin = base;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});
const call = async (path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> => {
  const go = () => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return go().catch((err: Error & { cause?: { code?: string } }) => (err.cause?.code === 'ECONNRESET' ? go() : Promise.reject(err)));
};
const owner = { authorization: `Bearer ${token}` };
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];

test('passkeys through the server: add while signed in, then sign in with it (no token)', async () => {
  const site = { rpId: 'localhost', origin };
  const a = new SoftAuthenticator();
  assert.equal((await call('/api/passkey/signin-options', {})).status, 404, 'none yet');
  assert.equal((await (await call('/api/session')).json()).passkeys, undefined);
  // Adding a passkey needs proof it's you, not just a session.
  assert.equal((await call('/api/passkey/register-options', {}, owner)).status, 403);
  assert.equal((await call('/api/passkey/register-options', { token: 'wrong' }, owner)).status, 403);
  const o = await (await call('/api/passkey/register-options', { token }, owner)).json();
  assert.equal(o.rp.id, 'localhost');
  assert.equal(o.authenticatorSelection.userVerification, 'required');
  const reg = await call('/api/passkey/register', { label: 'Test key', ...a.create({ challenge: o.challenge, ...site }) }, owner);
  assert.equal(reg.status, 200, await reg.clone().text());
  assert.equal((await reg.json()).passkeys[0].label, 'Test key');
  // The same challenge can't be used twice.
  assert.equal((await call('/api/passkey/register', a.create({ challenge: o.challenge, ...site }), owner)).status, 400);
  assert.equal((await (await call('/api/session')).json()).passkeys, true);

  const so = await (await call('/api/passkey/signin-options', {})).json();
  const r = await call('/api/passkey/signin', a.get({ challenge: so.challenge, ...site }));
  assert.equal(r.status, 200);
  const c = cookieOf(r);
  assert.match(c, /^sara_session=/);
  assert.equal((await (await call('/api/session', undefined, { cookie: c })).json()).authenticated, true);
  // Replaying that sign-in fails; so does a request from another site.
  assert.equal((await call('/api/passkey/signin', a.get({ challenge: so.challenge, ...site }))).status, 401);
  assert.equal((await call('/api/passkey/signin-options', {}, { origin: 'https://evil.example' })).status, 403);
  const list = await (await call('/api/security', undefined, owner)).json();
  assert.equal(list.passkeys.length, 1);
  assert.equal(list.passkeys[0].jwk, undefined, 'keys are not sent back');
  assert.ok(list.passkeys[0].lastUsedAt);
});

test('two-step sign-in: set up with a code, then the token needs a code; Bearer alone stops working; reset-token is the way back', async () => {
  assert.equal((await call('/api/two-step/start', {}, owner)).status, 403, 'needs the token');
  // Another device signed in before two-step: it gets signed out when two-step goes on.
  const other = cookieOf(await call('/api/login', { token }));
  const start = await (await call('/api/two-step/start', { token }, owner)).json();
  assert.match(start.url, /^otpauth:\/\/totp\/Sara:/);
  assert.match(start.qr, /^data:image\/svg\+xml;base64,/);
  assert.equal((await call('/api/two-step/confirm', { code: '000000' }, owner)).status, 400);
  const now = () => clock.now.getTime();
  const on = await (await call('/api/two-step/confirm', { code: hotp(start.secret, totpCounter(now())) }, owner)).json();
  assert.ok(on.signedOut >= 1);
  assert.equal((await (await call('/api/session', undefined, { cookie: other })).json()).authenticated, false, 'the other device is signed out');
  // Now: token alone → asked for a code.
  const ask = await call('/api/login', { token });
  assert.equal(ask.status, 401);
  assert.equal((await ask.json()).twoStep, true);
  assert.equal((await call('/api/login', { token, code: '123456' })).status, 401);
  clock.now = new Date(clock.now.getTime() + 30_000);
  const ok = await call('/api/login', { token, code: hotp(start.secret, totpCounter(now())) });
  assert.equal(ok.status, 200);
  const c = cookieOf(ok);
  // The owner token as a Bearer header no longer opens the API.
  assert.equal((await call('/api/security', undefined, owner)).status, 401);
  assert.equal((await (await call('/api/security', undefined, { cookie: c })).json()).twoStep, true);
  // Turning it off needs a current code.
  assert.equal((await call('/api/two-step/stop', { code: '000000' }, { cookie: c })).status, 400);
  clock.now = new Date(clock.now.getTime() + 30_000);
  assert.equal((await call('/api/two-step/stop', { code: hotp(start.secret, totpCounter(now())) }, { cookie: c })).status, 200);
  assert.equal((await call('/api/security', undefined, owner)).status, 200, 'token works again');

  // Removing a passkey also needs proof.
  const pk = (await (await call('/api/security', undefined, { cookie: c })).json()).passkeys[0];
  assert.equal((await call('/api/passkey/remove', { id: pk.id }, { cookie: c })).status, 403);
  assert.equal((await call('/api/passkey/remove', { id: 'nope', token }, { cookie: c })).status, 404);

  // The server-side reset keeps passkeys (unless asked); a new token from the app removes them.
  const fresh = new OwnerAuth(dir, () => clock.now);
  fresh.resetToken();
  assert.equal(fresh.passkeys().length, 1);
  const t2 = fresh.resetToken();
  fresh.rotateToken(t2, { clearPasskeys: false });
  assert.equal(fresh.passkeys().length, 1);
  fresh.rotateToken(fresh.resetToken());
  assert.equal(fresh.passkeys().length, 0);
  fresh.resetToken({ clearSecurity: true });
  assert.equal(fresh.passkeys().length, 0);
  assert.equal(fresh.twoStepOn, false);
});

test('sign-out and the demo start refuse cross-site form posts; limiter counts IPv6 per /64', async () => {
  const form = await fetch(base + '/api/logout', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }, body: 'a=1' });
  assert.equal(form.status, 415);
  assert.equal((await call('/api/logout', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/logout', {})).status, 200);
  const l = new LoginLimiter(3);
  l.fail('2001:db8:1:2::1');
  l.fail('2001:db8:1:2:ffff::9');
  l.fail('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd');
  assert.equal(l.blocked('2001:db8:1:2::77'), true);
  assert.equal(l.blocked('2001:db8:1:3::1'), false);
  for (let i = 0; i < 14; i++) l.fail('9.9.9.9', Date.now(), 0.2);
  assert.equal(l.blocked('9.9.9.9'), false);
  l.fail('9.9.9.9', Date.now(), 0.2);
  assert.equal(l.blocked('9.9.9.9'), true);
});
