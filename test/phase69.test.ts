// Phase 69: video calls. The server side of the owner's optional camera: the frame route, its limits
// and caps, the demo / private-local / private-conversation / group refusals, the safety pause, the
// settings, the picture reaching the model (classic calls: with the next message, never saved; live
// calls: an input_image item on OpenAI, self-view only on Grok), and the app's pure video logic.
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import type { Upstream } from '../src/live.ts';
import { setPrivateLocal } from '../src/net-guard.ts';
import { createSaraServer } from '../src/server.ts';
import { cameraState, checkFrame, DEFAULT_VIDEO, FRAME_FRESH_MS, FrameGate, jpegSize, MIN_GAP_MS, modelSees, modelSeesByName, ollamaSees, parseVideoSettings, SAFETY_PAUSE_MS, VideoError, VideoSessions, videoSettings, videoCallNote } from '../src/video.ts';
// @ts-expect-error plain JS module shared with the browser
import { CaptionLog, expressionFromText, fitWithin, formatCallTime, FramePacer } from '../web/video-logic.js';
import type { ProviderConfig } from '../src/providers/types.ts';
import { makeApp, ROOT, tempDir, text } from './helpers.ts';

/** A tiny JPEG: SOI, a SOF0 header with the size, EOI (enough for the size check). */
function jpeg(w: number, h: number, pad = 0): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return Buffer.concat([Buffer.from([0xff, 0xd8, ...app0, ...sof]), Buffer.alloc(pad, 0x55), Buffer.from([0xff, 0xd9])]);
}

test('video: JPEG size check, frame limits, settings validation', () => {
  assert.deepEqual(jpegSize(jpeg(512, 384)), { width: 512, height: 384 });
  assert.equal(jpegSize(Buffer.from('not a picture')), null);
  assert.equal(jpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.deepEqual(checkFrame(jpeg(512, 384)), { width: 512, height: 384 });
  const code = (f: () => unknown) => {
    try {
      f();
    } catch (err) {
      return (err as VideoError).status;
    }
    return 0;
  };
  assert.equal(code(() => checkFrame(Buffer.from('GIF89a....'))), 415);
  assert.equal(code(() => checkFrame(Buffer.alloc(0))), 400);
  assert.equal(code(() => checkFrame(jpeg(2000, 1000))), 413);
  assert.equal(code(() => checkFrame(jpeg(512, 384, 400_001))), 413);

  // Every 10 s by default, never under 3 s even when asked, and a per-call cap.
  const g = new FrameGate({ lookEvery: 10, perCall: 20 });
  assert.equal(g.take(0, false).used, 1);
  assert.equal(code(() => g.take(5_000, false)), 429);
  assert.equal(code(() => g.take(1_000, true)), 429, 'asking is limited too');
  assert.equal(g.take(MIN_GAP_MS, true).used, 2);
  assert.equal(g.take(MIN_GAP_MS + 10_000, false).left, 17);
  for (let i = 0; i < 17; i++) g.take(100_000 + i * 10_000, false);
  assert.equal(code(() => g.take(10_000_000, true)), 429, 'the cap holds');
  // "Only when I ask": automatic pictures are refused.
  const ask = new FrameGate({ lookEvery: 0, perCall: 20 });
  assert.equal(code(() => ask.take(0, false)), 409);
  assert.equal(ask.take(0, true).used, 1);

  assert.deepEqual(videoSettings(undefined), DEFAULT_VIDEO);
  assert.deepEqual(videoSettings({ lookEvery: 7 as never, perCall: 40 }), { lookEvery: 10, perCall: 40 });
  assert.deepEqual(parseVideoSettings({ lookEvery: 5, perCall: '120' }, DEFAULT_VIDEO), { lookEvery: 5, perCall: 120 });
  assert.deepEqual(parseVideoSettings(undefined, DEFAULT_VIDEO), DEFAULT_VIDEO);
  for (const bad of [{ lookEvery: 1 }, { perCall: 1000 }, { lookEvery: true }, 'often', [5]]) assert.equal(code(() => parseVideoSettings(bad, DEFAULT_VIDEO)), 400, JSON.stringify(bad));
});

test('video: who may get camera pictures (demo, groups, partners, private modes, safety pause, what the model can see)', () => {
  const now = 1_000_000_000;
  type P = Pick<ProviderConfig, 'kind' | 'baseUrl' | 'label' | 'local'>;
  const local: P = { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', label: 'Ollama', local: true };
  const cloud: P = { kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', label: 'Cloud' };
  const classic = (provider: P = local, model = 'gemma4:27b', sees = true) => ({ kind: 'classic' as const, provider, model, sees });
  const base = { privateLocal: false, now };
  assert.deepEqual(cameraState({ ...base, target: classic() }).allowed, true);
  assert.equal(cameraState({ ...base, target: classic() }).sees, true);
  assert.match(cameraState({ ...base, demo: true, target: classic() }).message!, /demo/);
  assert.equal(cameraState({ ...base, group: true, target: classic() }).allowed, false);
  assert.equal(cameraState({ ...base, partner: true, target: classic() }).allowed, false);
  // Nothing leaves this computer: a model on this computer is fine; a cloud model or a live voice service isn't.
  assert.equal(cameraState({ ...base, privateLocal: true, target: classic() }).allowed, true);
  assert.match(cameraState({ ...base, privateLocal: true, target: classic(cloud, 'gpt-5') }).message!, /Nothing leaves this computer/);
  assert.equal(cameraState({ ...base, privateLocal: true, target: classic(local, 'gpt-oss:120b-cloud') }).allowed, false, 'an Ollama Cloud model is cloud');
  assert.equal(cameraState({ ...base, privateLocal: true, target: { kind: 'live', engine: 'openai' } }).allowed, false);
  // A private conversation: only the owner's own hardware.
  assert.equal(cameraState({ ...base, privateConv: true, target: classic(cloud, 'gpt-5') }).allowed, false);
  assert.equal(cameraState({ ...base, privateConv: true, target: classic() }).allowed, true);
  // After a safety block in the conversation: paused for an hour.
  assert.match(cameraState({ ...base, lastBlockAt: now - 60_000, target: classic() }).message!, /safety block/);
  assert.equal(cameraState({ ...base, lastBlockAt: now - SAFETY_PAUSE_MS - 1, target: classic() }).allowed, true);
  // What the model can see: no pretending.
  const blind = cameraState({ ...base, target: classic(local, 'llama3.1:8b', false) });
  assert.deepEqual([blind.allowed, blind.sees], [false, false]);
  assert.match(blind.message!, /only shown to you/);
  assert.equal(blind.params?.model, 'llama3.1:8b');
  const grok = cameraState({ ...base, target: { kind: 'live', engine: 'grok' } });
  assert.deepEqual([grok.allowed, grok.sees], [false, false]);
  assert.match(grok.message!, /Grok voice can’t look at pictures/);
  assert.deepEqual([cameraState({ ...base, target: { kind: 'live', engine: 'openai' } }).allowed, cameraState({ ...base, target: { kind: 'live', engine: 'openai' } }).sees], [true, true]);

  assert.equal(modelSeesByName('gemma4:27b'), true);
  assert.equal(modelSeesByName('qwen2.5vl:7b'), true);
  assert.equal(modelSeesByName('gpt-4o'), true);
  assert.equal(modelSeesByName('llama3.1:8b'), false);
  assert.equal(modelSeesByName('gpt-4o-mini-transcribe'), false);
  assert.equal(modelSeesByName('nomic-embed-text'), false);
  assert.match(videoCallNote('Pat', false), /can't see Pat's camera/);
  assert.match(videoCallNote('Pat', true), /never|Only talk about what is really in a picture/);
});

test('video: Ollama is asked whether a model takes pictures (capabilities), then known names', async () => {
  let calls = 0;
  const fake = (async (url: string) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:59999/api/tags');
    return new Response(JSON.stringify({ models: [{ name: 'eyes:latest', capabilities: ['completion', 'vision'] }, { name: 'gemma4:27b', capabilities: ['completion'] }] }));
  }) as unknown as typeof fetch;
  assert.equal(await ollamaSees('http://127.0.0.1:59999/v1', 'eyes', 1, fake), true);
  assert.equal(await ollamaSees('http://127.0.0.1:59999/v1', 'eyes', 2, fake), true);
  assert.equal(calls, 1, 'cached');
  // Ollama's own answer wins over the name list (this gemma4 build has no vision).
  const tags = (async () => new Response(JSON.stringify({ models: [{ name: 'gemma4:27b', capabilities: ['completion'] }] }))) as unknown as typeof fetch;
  assert.equal(await modelSees({ kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' }, 'gemma4:27b', 3, tags), false);
  // Can't ask: the name decides. Subscription programs get text only.
  const down = (async () => {
    throw new Error('down');
  }) as unknown as typeof fetch;
  assert.equal(await modelSees({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:59998/v1' }, 'llava:13b', 4, down), true);
  assert.equal(await modelSees({ kind: 'claude-code', baseUrl: '' }, 'claude-sonnet-4-5', 5, down), false);
});

test('video: a classic call keeps only the newest picture, in memory, and only while fresh', () => {
  const v = new VideoSessions();
  v.keep('c1', Buffer.from('x'), 0, false); // no call: ignored
  assert.equal(v.take('c1', 0), undefined);
  v.start('c1', DEFAULT_VIDEO, 0);
  v.keep('c1', Buffer.from('a'), 0, false);
  v.keep('c1', Buffer.from('b'), 1000, false);
  assert.equal(v.take('c1', 2000)?.toString(), 'b');
  assert.equal(v.take('c1', 5000)?.toString(), 'b', 'not used up: the next message still sees the current view');
  v.keep('c1', Buffer.from('c'), 3000, false);
  assert.equal(v.take('c1', 3000 + FRAME_FRESH_MS + 1), undefined, 'too old');
  assert.equal(v.end('c1'), true);
  assert.equal(v.size, 0);
});

test('video: the app logic (timer, picture size, pacing, expressions, captions)', () => {
  assert.equal(formatCallTime(5_400), '0:05');
  assert.equal(formatCallTime(754_000), '12:34');
  assert.equal(formatCallTime(3_723_000), '1:02:03');
  assert.deepEqual(fitWithin(1280, 720, 512), { width: 512, height: 288 });
  assert.deepEqual(fitWithin(480, 640, 512), { width: 384, height: 512 });
  assert.deepEqual(fitWithin(320, 240, 512), { width: 320, height: 240 }, 'never enlarged');
  const p = new FramePacer({ everySec: 10, perCall: 2 });
  assert.equal(p.due(0), true);
  p.mark(0);
  assert.equal(p.due(9_000), false);
  assert.equal(p.canAsk(2_000), false);
  assert.equal(p.canAsk(3_000), true);
  p.mark(3_000);
  assert.equal(p.left, 0);
  assert.equal(p.due(60_000), false, 'cap');
  assert.equal(new FramePacer({ everySec: 0, perCall: 5 }).due(99_999), false, 'only when asked');
  assert.equal(expressionFromText('Haha, that is so you'), 'happy');
  assert.equal(expressionFromText("Oh no, I'm so sorry to hear that"), 'caring');
  assert.equal(expressionFromText("I'm just teasing 😏"), 'playful');
  assert.equal(expressionFromText('It is getting late, I am sleepy'), 'sleepy');
  assert.equal(expressionFromText('Ouch, that hurt'), 'hurt');
  assert.equal(expressionFromText('The meeting is at three.'), null);
  const c = new CaptionLog({ maxLines: 3, maxChars: 30 });
  c.you('hel', false);
  c.you('hello there', true);
  c.her('Hi ');
  c.her('you!');
  assert.deepEqual(c.lines(), [{ who: 'you', text: 'hello there' }, { who: 'her', text: 'Hi you!' }]);
  c.herDone('Hi you! …');
  c.you('a', true);
  c.her('one two three four five six seven eight nine ten');
  const lines = c.lines();
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, 'Hi you! …');
  assert.ok(lines[2].text.startsWith('…') && lines[2].text.length <= 31 && lines[2].text.endsWith('ten'));
});

async function server(t: import('node:test').TestContext, opts: { demo?: boolean; liveConnect?: (url: string, key: string) => Upstream; setup?: (app: ReturnType<typeof makeApp>) => void } = {}) {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-28T20:00:00Z') };
  const app = makeApp(dir, clock);
  app.settings.update({
    ownerName: 'Pat',
    disclosureAcceptedAt: '2026-10-28T19:00:00Z',
    // Not 11434: no real Ollama is asked in tests; the model name decides.
    providers: [{ id: 'p', label: 'Local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', local: true, defaultModel: 'gemma4:27b' }],
    defaultProviderId: 'p',
    defaultModel: 'gemma4:27b',
  });
  opts.setup?.(app);
  const auth = new OwnerAuth(app.dataDir);
  const srv = createSaraServer({ app, auth, webDir: join(ROOT, 'web'), ...(opts.demo ? { demo: true } : {}), ...(opts.liveConnect ? { liveConnect: opts.liveConnect } : {}) });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => {
    setPrivateLocal(false);
    srv.close();
    app.store.close();
    cleanup();
  });
  const port = (srv.address() as AddressInfo).port;
  const H = { authorization: `Bearer ${auth.newToken}` };
  const call = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}/api${path}`, { ...init, headers: { ...H, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const api = async (path: string, init: RequestInit = {}) => (await call(path, init)).json();
  const frame = (id: string, body: Buffer, ask = false) => fetch(`http://127.0.0.1:${port}/api/video/${id}/frame${ask ? '?ask=1' : ''}`, { method: 'POST', headers: { ...H, 'content-type': 'image/jpeg' }, body: new Uint8Array(body) });
  return { app, clock, port, H, call, api, frame, dir };
}

test('video (classic call): start, frame limits, the picture goes with the next message only, never saved', async (t) => {
  const { app, clock, call, api, frame, dir } = await server(t);
  // The page may use the camera (only its own origin; previews of her apps still may not).
  assert.match(String((await call('/session')).headers.get('permissions-policy')), /camera=\(self\)/);
  const conv = await api('/conversations', { method: 'POST', body: '{}' });
  const st = await api(`/video/${conv.id}`);
  assert.deepEqual([st.camera.allowed, st.camera.sees, st.session], [true, true, null]);
  assert.match(st.camera.goesTo, /Local \(gemma4:27b\)/);

  // No video call started: refused.
  assert.equal((await frame(conv.id, jpeg(512, 384))).status, 409);
  const started = await api(`/video/${conv.id}/start`, { method: 'POST', body: '{}' });
  assert.deepEqual(started.session, { used: 0, perCall: 60, lookEvery: 10 });
  // Not a JPEG, too big, too large a body.
  assert.equal((await frame(conv.id, Buffer.from('<svg/>'))).status, 415);
  assert.equal((await frame(conv.id, jpeg(1600, 1200))).status, 413);
  assert.equal((await frame(conv.id, jpeg(512, 384, 500_000))).status, 413);
  const ok = await frame(conv.id, jpeg(512, 384));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, via: 'next-reply', used: 1, left: 59 });
  // Too soon (every 10 s), but asking may go after 3 s.
  assert.equal((await frame(conv.id, jpeg(512, 384))).status, 429);
  clock.now = new Date(clock.now.getTime() + 3_000);
  assert.equal((await frame(conv.id, jpeg(512, 384), true)).status, 200);

  // The newest picture rides on the next message to the model, with the note; the stored message has no picture.
  app.script.push(text('I can see a plant behind you!'));
  const res = await call(`/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'can you see me?', liveFrame: true, liveFrameAsk: true }) });
  await res.text();
  const req = app.requests.at(-1)!;
  const last = req.messages.filter((m) => m.role === 'user').at(-1) as { content: string; images?: { mime: string; data: string }[] };
  assert.equal(last.images?.length, 1);
  assert.equal(last.images![0].mime, 'image/jpeg');
  assert.deepEqual(Buffer.from(last.images![0].data, 'base64'), jpeg(512, 384));
  assert.match(last.content, /can you see me\?[\s\S]*still picture from their camera/);
  const stored = app.store.messages(conv.id).filter((m) => m.role === 'user').at(-1)!;
  assert.equal(stored.content, 'can you see me?');
  assert.equal(stored.meta?.images, undefined);
  assert.equal(existsSync(join(dir, 'uploads')) ? readdirSync(join(dir, 'uploads')).length : 0, 0, 'nothing written to disk');
  // A second sentence a few seconds later still goes with the current view (not used up).
  app.script.push(text('Still you.'));
  await (await call(`/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'still see me?', liveFrame: true, videoCall: true }) })).text();
  const again = app.requests.at(-1)!.messages.filter((m) => m.role === 'user').at(-1) as { content: string; images?: unknown[] };
  assert.equal(again.images?.length, 1);
  // Camera off: no picture, and she is told plainly that she can't see.
  app.script.push(text('Sure.'));
  await (await call(`/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'and now?', videoCall: true }) })).text();
  const noPic = app.requests.at(-1)!.messages.filter((m) => m.role === 'user').at(-1) as { content: string; images?: unknown[] };
  assert.equal(noPic.images, undefined);
  assert.match(noPic.content, /and now\?[\s\S]*no picture from their camera reached you/);
  assert.equal(app.store.messages(conv.id).filter((m) => m.role === 'user').at(-1)!.content, 'and now?');

  // A safety block in this conversation pauses the camera (refused; a waiting picture isn't used).
  clock.now = new Date(clock.now.getTime() + 20_000);
  assert.equal((await frame(conv.id, jpeg(512, 384))).status, 200);
  app.store.recordSafetyEvent('minor_sexual_block', conv.id);
  const paused = await frame(conv.id, jpeg(512, 384), true);
  assert.equal(paused.status, 403);
  assert.match((await paused.json()).error, /paused in this conversation after a safety block/);
  app.script.push(text('ok'));
  await (await call(`/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ content: 'hello', liveFrame: true }) })).text();
  assert.equal((app.requests.at(-1)!.messages.filter((m) => m.role === 'user').at(-1) as { images?: unknown[] }).images, undefined);

  // End: the call and its picture are forgotten.
  assert.deepEqual(await api(`/video/${conv.id}/end`, { method: 'POST', body: '{}' }), { ended: true });
  assert.equal((await api(`/video/${conv.id}`)).session, null);
});

test('video: settings (Settings → Voice), the per-call cap, "only when I ask", a model that can’t see, groups', async (t) => {
  const { app, clock, api, call, frame } = await server(t);
  // Validated, saved per companion with the voice settings.
  assert.equal((await call('/voice', { method: 'PUT', body: JSON.stringify({ video: { lookEvery: 7 } }) })).status, 400);
  assert.equal((await call('/voice', { method: 'PUT', body: JSON.stringify({ video: { perCall: 'lots' } }) })).status, 400);
  const v = await api('/voice', { method: 'PUT', body: JSON.stringify({ video: { lookEvery: 0, perCall: 20 } }) });
  assert.deepEqual(v.video, { lookEvery: 0, perCall: 20 });
  assert.deepEqual((await api('/voice')).settings.video, { lookEvery: 0, perCall: 20 });

  const conv = await api('/conversations', { method: 'POST', body: '{}' });
  await api(`/video/${conv.id}/start`, { method: 'POST', body: '{}' });
  const auto = await frame(conv.id, jpeg(320, 240));
  assert.equal(auto.status, 409, 'only when asked');
  for (let i = 0; i < 20; i++) {
    assert.equal((await frame(conv.id, jpeg(320, 240), true)).status, 200, `picture ${i + 1}`);
    clock.now = new Date(clock.now.getTime() + 3_000);
  }
  const capped = await frame(conv.id, jpeg(320, 240), true);
  assert.equal(capped.status, 429);
  const body = await capped.json();
  assert.equal(body.errorKey, 'She already looked {n} times on this call (the limit in Settings → Voice).');
  assert.deepEqual(body.params, { n: 20 });

  // A model that can't look at pictures: the camera is a self-view, and the server refuses pictures.
  app.settings.update({ defaultModel: 'llama3.1:8b' });
  const blind = await api(`/video/${conv.id}`);
  assert.deepEqual([blind.camera.allowed, blind.camera.sees], [false, false]);
  assert.equal(blind.camera.params.model, 'llama3.1:8b');
  clock.now = new Date(clock.now.getTime() + 60_000);
  assert.equal((await frame(conv.id, jpeg(320, 240), true)).status, 403);

  // Group chats: no video calls.
  app.settings.update({ defaultModel: 'gemma4:27b' });
  const g = app.store.createConversation({ title: 'Group', channel: 'group', channelKey: 'r1' });
  assert.equal((await call(`/video/${g.id}/start`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await api(`/video/${g.id}`)).camera.allowed, false);
  assert.equal((await call('/video/nope')).status, 404);
});

test('video: “Nothing leaves this computer” refuses pictures for a cloud model, allows a model on this computer', async (t) => {
  const { app, api, frame } = await server(t, {
    setup: (app) => app.settings.update({ providers: [{ id: 'c', label: 'Cloud', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', defaultModel: 'gpt-5' }, { id: 'p', label: 'Local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', local: true }], defaultProviderId: 'c', defaultModel: 'gpt-5' }),
  });
  const conv = await api('/conversations', { method: 'POST', body: '{}' });
  await api(`/video/${conv.id}/start`, { method: 'POST', body: '{}' });
  assert.equal((await api(`/video/${conv.id}`)).camera.allowed, true, 'cloud model, mode off: allowed');
  setPrivateLocal(true);
  const st = await api(`/video/${conv.id}`);
  assert.equal(st.camera.allowed, false);
  const r = await frame(conv.id, jpeg(320, 240), true);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /Nothing leaves this computer|isn't on this computer|paused in private local mode/);
  // A model on this computer: allowed again.
  app.settings.update({ defaultProviderId: 'p', defaultModel: 'gemma4:27b' });
  assert.equal((await api(`/video/${conv.id}`)).camera.allowed, true);
  assert.equal((await frame(conv.id, jpeg(320, 240), true)).status, 200);
  setPrivateLocal(false);
  // A private conversation with a cloud model: refused.
  app.settings.update({ defaultProviderId: 'c', defaultModel: 'gpt-5' });
  const priv = app.store.createConversation({ title: 'Private', private: true, providerId: 'c', model: 'gpt-5' });
  assert.equal((await api(`/video/${priv.id}`)).camera.allowed, false);
});

test('video: the demo server refuses the camera (and says so)', async (t) => {
  const { port } = await server(t, { demo: true });
  const base = `http://127.0.0.1:${port}`;
  const r = await fetch(`${base}/api/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: '{}' })).json();
  const st = await (await fetch(`${base}/api/video/${conv.id ?? 'x'}`, { headers: { cookie } })).json();
  assert.deepEqual([st.camera.allowed, st.camera.message], [false, 'The camera is off on the demo server.']);
  for (const path of ['frame', 'start']) {
    const f = await fetch(`${base}/api/video/${conv.id ?? 'x'}/${path}`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'image/jpeg' }, body: new Uint8Array(jpeg(320, 240)) });
    assert.equal(f.status, 403);
    assert.equal((await f.json()).error, 'The camera is off on the demo server.');
  }
});

/** A fake realtime voice service (OpenAI or Grok shape): records what it is sent. */
class FakeUp implements Upstream {
  onopen: Upstream['onopen'] = null;
  onmessage: Upstream['onmessage'] = null;
  onclose: Upstream['onclose'] = null;
  onerror: Upstream['onerror'] = null;
  sent: Record<string, unknown>[] = [];
  url = '';
  constructor() {
    setTimeout(() => this.onopen?.({}), 5);
  }
  send(d: string | ArrayBufferLike | Uint8Array) {
    if (typeof d !== 'string') return;
    const ev = JSON.parse(d) as Record<string, unknown>;
    this.sent.push(ev);
    if (ev.type === 'session.update' && this.sent.filter((e) => e.type === 'session.update').length === 1) this.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) });
  }
  close() {}
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 200 && !check(); i++) await wait(10);
  assert.ok(check(), `timed out waiting for ${what}`);
}

test('video (live call): OpenAI gets the picture as input_image (asked: she answers); Grok is self-view only', async (t) => {
  const ups: FakeUp[] = [];
  const { app, port, H, api, frame, clock } = await server(t, {
    liveConnect: (url) => {
      const up = new FakeUp();
      up.url = url;
      ups.push(up);
      return up;
    },
    setup: (app) => {
      app.settings.update({ voice: { live: 'openai' } as never });
      app.vault.set('voice:openai', 'sk-test');
    },
  });
  const conv = await api('/conversations', { method: 'POST', body: '{}' });
  // Before the call: pictures would go to OpenAI's live voice service.
  assert.match((await api(`/video/${conv.id}`)).camera.goesTo, /OpenAI/);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${conv.id}?video=1`, { headers: H } as unknown as string[]);
  const events: Record<string, unknown>[] = [];
  ws.onmessage = (m) => typeof m.data === 'string' && events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
  await until(() => events.some((e) => e.type === 'ready'), 'ready');
  const up = ups[0];
  assert.match(String((up.sent[0] as { session: { instructions: string } }).session.instructions), /## On a video call[\s\S]*still picture/);
  // The AI notice is still given at the start of a video call.
  assert.ok(events.some((e) => e.type === 'notice' && e.kind === 'disclosure'));
  await api(`/video/${conv.id}/start`, { method: 'POST', body: '{}' });
  const r = await frame(conv.id, jpeg(512, 384), true);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).via, 'live');
  const item = up.sent.find((e) => e.type === 'conversation.item.create') as { item: { role: string; content: { type: string; image_url?: string; text?: string }[] } };
  assert.equal(item.item.role, 'user');
  assert.equal(item.item.content[1].type, 'input_image');
  assert.equal(item.item.content[1].image_url, `data:image/jpeg;base64,${jpeg(512, 384).toString('base64')}`);
  assert.match(item.item.content[0].text!, /asked you to look/);
  assert.equal(up.sent.at(-1)!.type, 'response.create', 'asked: she answers');
  // After a safety block on the call, no more pictures.
  app.store.recordSafetyEvent('minor_sexual_block', conv.id);
  clock.now = new Date(clock.now.getTime() + 5_000);
  assert.equal((await frame(conv.id, jpeg(512, 384), true)).status, 403);
  ws.close();
});

test('video (live call on Grok): no pictures reach her; her instructions say she can’t see', async (t) => {
  const ups: FakeUp[] = [];
  const { port, H, api, frame } = await server(t, {
    liveConnect: (url) => {
      const up = new FakeUp();
      up.url = url;
      ups.push(up);
      return up;
    },
    setup: (app) => app.vault.set('voice:xai', 'xai-test'),
  });
  const conv = await api('/conversations', { method: 'POST', body: '{}' });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${conv.id}?video=1`, { headers: H } as unknown as string[]);
  const events: Record<string, unknown>[] = [];
  ws.onmessage = (m) => typeof m.data === 'string' && events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
  await until(() => events.some((e) => e.type === 'ready'), 'ready');
  assert.match(ups[0].url, /x\.ai/);
  assert.match(String((ups[0].sent[0] as { session: { instructions: string } }).session.instructions), /can't see Pat's camera/);
  const st = await api(`/video/${conv.id}/start`, { method: 'POST', body: '{}' });
  assert.deepEqual([st.camera.allowed, st.camera.sees], [false, false]);
  const r = await frame(conv.id, jpeg(512, 384), true);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /Grok voice can’t look at pictures/);
  assert.equal(ups[0].sent.filter((e) => e.type === 'conversation.item.create').length, 0);
  ws.close();
});

test('video: a voice call switched to video tells her (session.update with the video note)', async (t) => {
  const ups: FakeUp[] = [];
  const { port, H, api } = await server(t, {
    liveConnect: (url) => {
      const up = new FakeUp();
      up.url = url;
      ups.push(up);
      return up;
    },
    setup: (app) => {
      app.settings.update({ voice: { live: 'openai' } as never });
      app.vault.set('voice:openai', 'sk-test');
    },
  });
  const conv = await api('/conversations', { method: 'POST', body: '{}' });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${conv.id}`, { headers: H } as unknown as string[]);
  const events: Record<string, unknown>[] = [];
  ws.onmessage = (m) => typeof m.data === 'string' && events.push(JSON.parse(m.data));
  await new Promise((r) => (ws.onopen = r));
  await until(() => events.some((e) => e.type === 'ready'), 'ready');
  assert.doesNotMatch(String((ups[0].sent[0] as { session: { instructions: string } }).session.instructions), /On a video call/);
  ws.send(JSON.stringify({ type: 'video' }));
  await until(() => ups[0].sent.some((e) => e.type === 'session.update' && /On a video call/.test(JSON.stringify(e))), 'video note');
  ws.close();
});

test('classic video call: the current camera picture goes with every message while it is fresh', () => {
  const s = new VideoSessions();
  s.start('c1', DEFAULT_VIDEO, 0);
  const jpg = Buffer.from('frame');
  s.keep('c1', jpg, 1_000, false);
  assert.equal(s.take('c1', 2_000), jpg, 'first message');
  assert.equal(s.take('c1', 6_000), jpg, 'a second message a few seconds later still has it');
  assert.equal(s.take('c1', 1_000 + FRAME_FRESH_MS + 1), undefined, 'an old picture is not used');
  assert.equal(s.take('c1', 1_000 + FRAME_FRESH_MS + 2), undefined, 'and is forgotten');
});
