// Demo live calls for app review: only with the reviewer code (SARA_DEMO_CALL_CODE), 5 minutes a
// call, a daily budget of minutes for all demo visitors together, one call at a time.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { DEMO_CALL_FAILS_PER_DAY, DEMO_CALL_MAX_MS, DemoCallGate } from '../src/demo-calls.ts';
import type { Upstream } from '../src/live.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

test('demo call gate: no code set = calls off; the code unlocks one visitor only', () => {
  const off = new DemoCallGate({});
  assert.equal(off.enabled, false);
  assert.equal(off.unlock('v1', ''), false);
  assert.equal(off.unlock('v1', 'anything'), false);
  assert.deepEqual(off.begin('v1'), { ok: false, status: 403, reason: 'Live calls are off in the demo.' });
  assert.equal(new DemoCallGate({ code: '   ' }).enabled, false, 'a blank code is no code');

  // Hardening L3: a code under 12 characters is refused (calls stay off, and the log says why).
  const short = new DemoCallGate({ code: 'R3VIEW-42' });
  assert.equal(short.enabled, false);
  assert.match(short.refused ?? '', /shorter than 12/);
  assert.equal(short.unlock('v1', 'R3VIEW-42'), false);
  assert.equal(new DemoCallGate({}).refused, undefined, 'no code: nothing to complain about');

  const g = new DemoCallGate({ code: 'R3VIEW-42-QX7P' });
  assert.equal(g.enabled, true);
  assert.equal(g.view('v1').unlocked, false);
  const locked = g.begin('v1');
  assert.equal(locked.ok, false);
  assert.equal(!locked.ok && locked.status, 403);
  assert.equal(g.unlock('v1', 'wrong'), false);
  assert.equal(g.unlock('v1', 'R3VIEW-42-QX7'), false, 'a prefix is not the code');
  assert.equal(g.unlock('v1', ' R3VIEW-42-QX7P '), true, 'spaces around it are fine');
  assert.equal(g.unlocked('v1'), true);
  assert.equal(g.unlocked('v2'), false, 'another visitor still needs the code');
  g.forget('v1');
  assert.equal(g.unlocked('v1'), false);
});

test('demo call gate: 5 minutes a call, a shared daily budget, one call at a time, new day resets', () => {
  let now = Date.parse('2026-10-27T10:00:00Z');
  const g = new DemoCallGate({ code: 'c0de-c0de-c0de', minutesPerDay: 12, now: () => now });
  g.unlock('a', 'c0de-c0de-c0de');
  g.unlock('b', 'c0de-c0de-c0de');
  assert.equal(g.view('a').minutesLeft, 12);
  assert.equal(g.view('a').perCallMinutes, 5);

  const first = g.begin('a');
  assert.ok(first.ok);
  assert.equal(first.maxMs, DEMO_CALL_MAX_MS, 'each call is capped at 5 minutes');
  // One demo call at a time.
  const busy = g.begin('b');
  assert.equal(!busy.ok && busy.status, 409);
  now += 5 * 60_000;
  assert.equal(g.view('b').minutesLeft, 7, 'a call going on counts');
  first.done();
  first.done(); // booked once only
  assert.equal(g.view('b').minutesLeft, 7);

  const second = g.begin('b');
  assert.ok(second.ok);
  assert.equal(second.maxMs, 5 * 60_000);
  now += 5 * 60_000;
  second.done();
  // 2 minutes left today: the next call is capped at what's left.
  const third = g.begin('a');
  assert.ok(third.ok);
  assert.equal(third.maxMs, 2 * 60_000);
  now += 2 * 60_000;
  third.done();
  assert.equal(g.remainingMs(), 0);
  const none = g.begin('a');
  assert.equal(!none.ok && none.status, 429, 'the daily budget is used up for everyone');
  // The next day (UTC) starts over.
  now = Date.parse('2026-10-28T00:00:01Z');
  assert.equal(g.view('a').minutesLeft, 12);
  assert.ok(g.begin('a').ok);
});

test('demo call gate: default is 30 minutes a day; 0 means none', () => {
  assert.equal(new DemoCallGate({ code: 'c0de-c0de-c0de' }).view('x').minutesLeft, 30);
  const zero = new DemoCallGate({ code: 'c0de-c0de-c0de', minutesPerDay: 0 });
  zero.unlock('x', 'c0de-c0de-c0de');
  const r = zero.begin('x');
  assert.equal(!r.ok && r.status, 429);
});

test('demo call gate: wrong codes from all addresses together are capped per day', () => {
  let now = Date.parse('2026-10-27T10:00:00Z');
  const g = new DemoCallGate({ code: 'R3VIEW-42-QX7P', now: () => now });
  for (let i = 0; i < DEMO_CALL_FAILS_PER_DAY; i++) assert.equal(g.unlock(`visitor-${i}`, `guess-${i}`), false);
  assert.equal(g.lockedToday, true);
  assert.equal(g.unlock('reviewer', 'R3VIEW-42-QX7P'), false, 'even the right code waits until tomorrow');
  now = Date.parse('2026-10-28T00:00:01Z');
  assert.equal(g.lockedToday, false);
  assert.equal(g.unlock('reviewer', 'R3VIEW-42-QX7P'), true);
});

/** A stand-in for the voice service. */
class FakeVoice implements Upstream {
  onopen: Upstream['onopen'] = null;
  onmessage: Upstream['onmessage'] = null;
  onclose: Upstream['onclose'] = null;
  onerror: Upstream['onerror'] = null;
  sent: Record<string, unknown>[] = [];
  closed = false;
  constructor() {
    setTimeout(() => this.onopen?.({}), 5);
  }
  send(d: string | ArrayBufferLike | Uint8Array) {
    if (typeof d !== 'string') return;
    const ev = JSON.parse(d) as Record<string, unknown>;
    this.sent.push(ev);
    if (ev.type === 'session.update' && this.sent.filter((e) => e.type === 'session.update').length === 1) this.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) });
  }
  close() {
    this.closed = true;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 300 && !check(); i++) await wait(10);
  assert.ok(check(), `timed out waiting for ${what}`);
}

async function demoServer(t: { after: (fn: () => void) => void }, opts: { code?: string; minutes?: number; perCallMs?: number }) {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date() });
  // The demo's own voice sign-in (an xAI key stands in for the server's Grok sign-in here).
  app.vault.set('voice:xai', 'xai-demo-key');
  app.settings.update({ voice: { xai: { voiceId: 'ara', language: 'en' } } as never });
  const auth = new OwnerAuth(dir);
  const voices: FakeVoice[] = [];
  const server = createSaraServer({
    app,
    auth,
    webDir: join(ROOT, 'web'),
    demo: true,
    ...(opts.code !== undefined ? { demoCallCode: opts.code } : {}),
    ...(opts.minutes !== undefined ? { demoCallMinutesPerDay: opts.minutes } : {}),
    ...(opts.perCallMs !== undefined ? { demoCallPerCallMs: opts.perCallMs } : {}),
    liveConnect: () => {
      const v = new FakeVoice();
      voices.push(v);
      return v;
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const visitor = async () => {
    const r = await fetch(`${base}/api/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    const call = (path: string, o: { method?: string; body?: unknown } = {}) =>
      fetch(base + path, { method: o.method ?? 'GET', headers: { cookie, origin: base, ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    await call('/api/disclosure/accept', { method: 'POST', body: {} });
    const conv = (await (await call('/api/conversations', { method: 'POST', body: {} })).json()) as { id: string };
    const open = (id = conv.id, query = '') => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/api/live/${id}${query}`, { headers: { cookie, origin: base } } as unknown as string[]);
      const events: Record<string, unknown>[] = [];
      const result = new Promise<string>((r) => {
        ws.onopen = () => r('open');
        ws.onerror = () => r('refused');
      });
      ws.onmessage = (m) => typeof m.data === 'string' && events.push(JSON.parse(m.data));
      return { ws, events, result };
    };
    return { call, conv, open, cookie };
  };
  return { app, voices, visitor };
}

test('demo server: no reviewer code set = no calls (and no code to enter)', async (t) => {
  const { visitor } = await demoServer(t, {});
  const v = await visitor();
  const live = await (await v.call('/api/live')).json();
  assert.equal(live.available, false);
  assert.equal(live.demo.enabled, false);
  assert.equal((await v.call('/api/demo/call-code', { method: 'POST', body: { code: 'x' } })).status, 403);
  assert.equal(await v.open().result, 'refused');
});

test('demo server: the reviewer code gate, own conversations only, and the per-call cap', async (t) => {
  const { voices, visitor } = await demoServer(t, { code: 'review-code-2026', perCallMs: 400 });
  const a = await visitor();
  const b = await visitor();
  const live = await (await a.call('/api/live')).json();
  assert.equal(live.available, true);
  assert.deepEqual({ enabled: live.demo.enabled, unlocked: live.demo.unlocked }, { enabled: true, unlocked: false });
  // Without the code: refused.
  assert.equal(await a.open().result, 'refused');
  assert.equal(voices.length, 0);
  assert.equal((await a.call('/api/demo/call-code', { method: 'POST', body: { code: 'nope' } })).status, 403);
  const ok = await a.call('/api/demo/call-code', { method: 'POST', body: { code: 'review-code-2026' } });
  assert.equal(ok.status, 200);
  assert.equal((await (await a.call('/api/live')).json()).demo.unlocked, true, 'remembered for this demo session');
  assert.equal((await (await b.call('/api/live')).json()).demo.unlocked, false, 'not for other visitors');
  // Another visitor's conversation: not found, even with the code.
  assert.equal(await a.open(b.conv.id).result, 'refused');
  // Answering a ring isn't a thing in the demo.
  assert.equal(await a.open(a.conv.id, '?ring=r1').result, 'refused');
  // A real call: connects to the voice service and ends at the per-call cap.
  const c = a.open();
  assert.equal(await c.result, 'open');
  await until(() => c.events.some((e) => e.type === 'ready'), 'ready');
  assert.equal(voices.length, 1);
  await until(() => c.events.some((e) => e.type === 'ended'), 'the cap ends the call');
  assert.match(String(c.events.find((e) => e.type === 'ended')!.reason), /Demo calls last up to/);
  assert.equal(voices[0].closed, true);
});

test('demo server: the daily budget is shared by every visitor, one call at a time', async (t) => {
  // 0.02 minutes = 1.2 seconds a day for everyone.
  const { visitor } = await demoServer(t, { code: 'c0de-c0de-c0de', minutes: 0.02 });
  const a = await visitor();
  const b = await visitor();
  for (const v of [a, b]) assert.equal((await v.call('/api/demo/call-code', { method: 'POST', body: { code: 'c0de-c0de-c0de' } })).status, 200);
  const first = a.open();
  assert.equal(await first.result, 'open');
  await until(() => first.events.some((e) => e.type === 'ready'), 'ready');
  // A second demo call while one is going on: told to wait.
  const second = b.open();
  assert.equal(await second.result, 'open');
  await until(() => second.events.some((e) => e.type === 'ended'), 'refused while busy');
  assert.match(String(second.events.find((e) => e.type === 'ended')!.reason), /Another demo call/);
  // The first one runs out of today's minutes.
  await until(() => first.events.some((e) => e.type === 'ended'), 'daily budget ends the call');
  assert.match(String(first.events.find((e) => e.type === 'ended')!.reason), /all the demo calling for today/);
  // Nothing left today for anyone.
  const third = b.open();
  assert.equal(await third.result, 'open');
  await until(() => third.events.some((e) => e.type === 'ended'), 'no minutes left');
  assert.match(String(third.events.find((e) => e.type === 'ended')!.reason), /all the demo calling for today/);
  assert.equal((await (await a.call('/api/live')).json()).demo.minutesLeft, 0);
});

test('demo server: a call whose setup fails frees the demo call slot', async (t) => {
  let fail = true;
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date() });
  app.vault.set('voice:xai', 'xai-demo-key');
  app.settings.update({ voice: { xai: { voiceId: 'ara', language: 'en' } } as never });
  const voices: FakeVoice[] = [];
  const server = createSaraServer({
    app,
    auth: new OwnerAuth(dir),
    webDir: join(ROOT, 'web'),
    demo: true,
    demoCallCode: 'review-code-2026',
    demoCallPerCallMs: 300,
    liveConnect: () => {
      if (fail) throw new Error('voice service down');
      const v = new FakeVoice();
      voices.push(v);
      return v;
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const call = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await call('/api/disclosure/accept', {});
  const conv = (await (await call('/api/conversations', {})).json()) as { id: string };
  assert.equal((await call('/api/demo/call-code', { code: 'review-code-2026' })).status, 200);
  const open = () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/live/${conv.id}`, { headers: { cookie, origin: base } } as unknown as string[]);
    const events: Record<string, unknown>[] = [];
    ws.onmessage = (m) => typeof m.data === 'string' && events.push(JSON.parse(m.data));
    return { ws, events };
  };
  const first = open();
  await until(() => first.events.some((e) => e.type === 'ended'), 'the failed call ends');
  // The next call is not refused as "another demo call is going on".
  fail = false;
  const second = open();
  await until(() => second.events.some((e) => e.type === 'ready' || e.type === 'ended'), 'second call');
  assert.ok(!second.events.some((e) => e.type === 'ended' && /Another demo call/.test(String(e.reason))), JSON.stringify(second.events));
});
