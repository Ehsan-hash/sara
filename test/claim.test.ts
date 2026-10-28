// Phase 59: first sign-in in the browser (src/claim.ts): the claim window, the address and origin
// checks, one-time use, and that it is off for good once the owner has signed in.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { CLAIM_ALPHABET, CLAIM_MAX_FAILURES, claimModeFrom, claimWindowMs, FirstClaim, formatClaimCode, isPrivateAddress, normalizeClaimCode } from '../src/claim.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

test('claim: private addresses, modes, window setting, code format', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.21.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.3.4', '100.101.102.103', 'fd7a:115c:a1e0::1', 'fe80::1%eth0', '::ffff:192.168.0.2']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.128.0.1', '192.169.0.1', '2001:db8::1', '2a00:1450::1', '::ffff:8.8.8.8', 'unknown', '', '999.1.1.1']) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(claimModeFrom({}), 'code');
  assert.equal(claimModeFrom({ SARA_SETUP: 'browser' }), 'browser');
  assert.equal(claimModeFrom({ SARA_SETUP: 'off' }), 'off');
  assert.equal(claimModeFrom({ SARA_SETUP: 'browser', SARA_DEMO: '1' }), 'off', 'never on the demo server');
  assert.equal(claimWindowMs({}), 60 * 60_000);
  assert.equal(claimWindowMs({ SARA_SETUP_MINUTES: '1' }), 5 * 60_000);
  assert.equal(claimWindowMs({ SARA_SETUP_MINUTES: '100000' }), 1440 * 60_000);
  assert.equal(normalizeClaimCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(formatClaimCode('ABCDEFGH'), 'ABCD-EFGH');
  const c = new FirstClaim({ pending: () => true, mode: 'code' });
  assert.match(c.code!, new RegExp(`^[${CLAIM_ALPHABET}]{8}$`));
  assert.notEqual(new FirstClaim({ pending: () => true, mode: 'code' }).code, c.code, 'a new code at every start');
});

test('claim: open only while nobody has signed in, within the window, until too many wrong codes', () => {
  let now = 1_000_000;
  let pending = true;
  const c = new FirstClaim({ pending: () => pending, mode: 'code', windowMs: 30 * 60_000, now: () => now, code: 'ABCDEFGH' });
  assert.deepEqual(c.status(), { open: true, mode: 'code', minutesLeft: 30 });
  assert.equal(c.check('192.168.1.5', 'abcd-efgh').ok, true);
  const far = c.check('8.8.8.8', 'ABCDEFGH');
  assert.equal(!far.ok && far.status, 403, 'the right code from the internet');
  const wrong = c.check('192.168.1.5', 'ABCDEFGX');
  assert.equal(wrong.ok, false);
  assert.equal(!wrong.ok && wrong.wrongCode, true);
  assert.equal(c.check('192.168.1.5', undefined).ok, false, 'code mode needs the code');
  now += 30 * 60_000;
  assert.deepEqual(c.status(), { open: false, mode: 'code', closed: 'expired' });
  assert.equal(c.check('127.0.0.1', 'ABCDEFGH').ok, false, 'the right code after the window is refused');
  // Locked after too many wrong codes, whatever the address.
  const d = new FirstClaim({ pending: () => true, mode: 'code', code: 'ABCDEFGH' });
  for (let i = 0; i < CLAIM_MAX_FAILURES; i++) d.failed();
  assert.equal(d.status().closed, 'locked');
  assert.equal(d.check('127.0.0.1', 'ABCDEFGH').ok, false);
  // Browser mode: no code, but still private addresses only.
  const b = new FirstClaim({ pending: () => true, mode: 'browser' });
  assert.equal(b.check('10.21.21.3', undefined).ok, true);
  assert.equal(b.check('203.0.113.9', undefined).ok, false);
  // Off, or an owner already: nothing to say at all.
  assert.deepEqual(new FirstClaim({ pending: () => true, mode: 'off' }).status(), { open: false });
  assert.equal(new FirstClaim({ pending: () => true, mode: 'off' }).code, undefined);
  pending = false;
  assert.deepEqual(c.status(), { open: false });
  assert.equal(new FirstClaim({ pending: () => false, mode: 'code' }).code, undefined, 'no code printed for a server with an owner');
});

test('claim: owner files: new ones wait for the owner, old ones and resets never reopen setup', () => {
  const { dir, cleanup } = tempDir();
  try {
    const a = new OwnerAuth(dir);
    assert.equal(a.setupPending, true);
    assert.equal(new OwnerAuth(dir).setupPending, true, 'survives a restart');
    a.markSignedIn();
    assert.equal(new OwnerAuth(dir).setupPending, false);
    // A server from before Phase 59 (no setupPending in owner.json).
    const f = join(dir, 'owner.json');
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    delete raw.setupPending;
    writeFileSync(f, JSON.stringify(raw));
    assert.equal(new OwnerAuth(dir).setupPending, false);
    // A token reset (sara reset-token) on a new server closes it too.
    const { dir: d2, cleanup: c2 } = tempDir();
    try {
      const b = new OwnerAuth(d2);
      assert.equal(b.setupPending, true);
      b.resetToken({ clearSecurity: true });
      assert.equal(new OwnerAuth(d2).setupPending, false);
    } finally {
      c2();
    }
  } finally {
    cleanup();
  }
});

async function startServer(o: { mode?: 'code' | 'browser' | 'off'; trustProxy?: boolean; windowMs?: number; clock?: { t: number } } = {}) {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-27T12:00:00Z') };
  const app = makeApp(dir, clock);
  const auth = new OwnerAuth(dir, () => clock.now);
  const firstToken = auth.newToken!;
  writeFileSync(join(dir, 'first-token.txt'), `${firstToken}\n`);
  const claim = new FirstClaim({ pending: () => auth.setupPending, mode: o.mode ?? 'code', code: 'K7QF3M9P', windowMs: o.windowMs, ...(o.clock ? { now: () => o.clock!.t } : {}) });
  const server = createSaraServer({ app, auth, claim, webDir: join(ROOT, 'web'), ...(o.trustProxy ? { trustProxy: true } : {}) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(base + path, { method: init.method ?? 'GET', headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  const close = () => {
    server.close();
    app.store.close();
    cleanup();
  };
  return { dir, auth, firstToken, call, close };
}

test('claim over HTTP: the setup code makes a new token once, signs the browser in, and closes setup', async (t) => {
  const s = await startServer();
  t.after(s.close);
  const session = await (await s.call('/api/session')).json();
  assert.equal(session.claim.open, true);
  assert.equal(session.claim.mode, 'code');
  assert.equal(JSON.stringify(session).includes('K7QF'), false, 'the code itself is never sent to the browser');
  // Cross-origin and non-JSON requests are refused before anything is checked.
  assert.equal((await s.call('/api/claim', { method: 'POST', body: { code: 'K7QF-3M9P' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.call('/api/claim', { method: 'POST', body: { code: 'K7QF-3M9P' }, headers: { 'content-type': 'text/plain' } })).status, 415);
  // A wrong code, then no code.
  const bad = await s.call('/api/claim', { method: 'POST', body: { code: 'K7QF-3M9X' } });
  assert.equal(bad.status, 401);
  assert.equal((await s.call('/api/claim', { method: 'POST', body: {} })).status, 401);
  // The right code (any case, with or without the dash).
  const ok = await s.call('/api/claim', { method: 'POST', body: { code: 'k7qf 3m9p' } });
  assert.equal(ok.status, 200);
  const { token } = (await ok.json()) as { token: string };
  assert.ok(token && token !== s.firstToken);
  const cookie = ok.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await s.call('/api/conversations', { headers: { cookie } })).status, 200, 'the browser is signed in');
  assert.equal(s.auth.verifyToken(token), true);
  assert.equal(s.auth.verifyToken(s.firstToken), false, 'the token printed in the log no longer works');
  assert.equal(existsSync(join(s.dir, 'first-token.txt')), false);
  assert.equal(s.auth.setupPending, false);
  // One time only.
  const again = await s.call('/api/claim', { method: 'POST', body: { code: 'K7QF3M9P' } });
  assert.equal(again.status, 404);
  assert.deepEqual(await (await s.call('/api/claim')).json(), { open: false });
  assert.equal((await (await s.call('/api/session')).json()).claim, undefined);
});

test('claim over HTTP: off once the owner signed in with the token', async (t) => {
  const s = await startServer();
  t.after(s.close);
  assert.equal((await s.call('/api/login', { method: 'POST', body: { token: s.firstToken } })).status, 200);
  assert.equal(s.auth.setupPending, false);
  assert.equal((await s.call('/api/claim', { method: 'POST', body: { code: 'K7QF3M9P' } })).status, 404);
  assert.equal((await (await s.call('/api/session')).json()).claim, undefined);
});

test('claim over HTTP: the bearer owner token also ends setup', async (t) => {
  const s = await startServer();
  t.after(s.close);
  assert.equal((await s.call('/api/conversations', { headers: { authorization: `Bearer ${s.firstToken}` } })).status, 200);
  assert.equal((await s.call('/api/claim', { method: 'POST', body: { code: 'K7QF3M9P' } })).status, 404);
});

test('claim over HTTP: internet addresses are refused; ten wrong codes from many addresses lock it', async (t) => {
  const s = await startServer({ trustProxy: true });
  t.after(s.close);
  const from = (ip: string, code: string) => s.call('/api/claim', { method: 'POST', body: { code }, headers: { 'x-forwarded-for': ip } });
  assert.equal((await from('203.0.113.7', 'K7QF3M9P')).status, 403, 'the right code from the internet');
  for (let i = 0; i < CLAIM_MAX_FAILURES; i++) assert.equal((await from(`192.168.1.${10 + i}`, 'AAAAAAAA')).status, 401);
  const locked = await from('192.168.1.99', 'K7QF3M9P');
  assert.equal(locked.status, 404);
  assert.match(((await locked.json()) as { error: string }).error, /Too many wrong setup codes/);
  assert.equal(((await (await s.call('/api/claim')).json()) as { closed: string }).closed, 'locked');
  assert.equal(s.auth.verifyToken(s.firstToken), true, 'the owner token from the log still works');
});

test('claim over HTTP: the window closes; browser mode needs no code; off mode has none', async (t) => {
  const clock = { t: Date.now() };
  const s = await startServer({ windowMs: 10 * 60_000, clock });
  t.after(s.close);
  clock.t += 11 * 60_000;
  const late = await s.call('/api/claim', { method: 'POST', body: { code: 'K7QF3M9P' } });
  assert.equal(late.status, 404);
  assert.match(((await late.json()) as { error: string }).error, /timed out/);
  assert.equal((await (await s.call('/api/session')).json()).claim.closed, 'expired');

  const b = await startServer({ mode: 'browser' });
  t.after(b.close);
  assert.equal((await (await b.call('/api/session')).json()).claim.mode, 'browser');
  const ok = await b.call('/api/claim', { method: 'POST', body: {} });
  assert.equal(ok.status, 200);
  assert.ok(((await ok.json()) as { token: string }).token);
  assert.equal((await b.call('/api/claim', { method: 'POST', body: {} })).status, 404, 'once');

  const off = await startServer({ mode: 'off' });
  t.after(off.close);
  assert.deepEqual(await (await off.call('/api/claim')).json(), { open: false });
  assert.equal((await (await off.call('/api/session')).json()).claim, undefined);
  assert.equal((await off.call('/api/claim', { method: 'POST', body: {} })).status, 404);
});
