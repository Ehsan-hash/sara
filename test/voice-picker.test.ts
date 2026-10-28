// The simple Grok voice picker: samples to choose by ear (kept on the server), and choosing a
// voice saves it without touching anything else.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date() };
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') } as never);
let base = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, 'localhost', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});
const get = (path: string) => fetch(base + path, { headers: { authorization: `Bearer ${token}` } });

test('voice samples: odd names refused; a kept sample plays without asking Grok again', async () => {
  assert.equal((await get('/api/voice/xai-sample?voice=../../etc')).status, 400);
  assert.equal((await get('/api/voice/xai-sample?voice=eve&lang=x/y')).status, 400);
  // No Grok sign-in and nothing kept yet: a plain message, not a crash.
  const none = await get('/api/voice/xai-sample?voice=eve');
  assert.equal(none.status, 400);
  assert.match((await none.json()).error, /Sign in to Grok/);
  // A kept sample is served as is.
  const text = `Hi, it's ${app.persona.name}. This is how I'd sound if you pick this voice.`;
  const cache = join(dir, 'cache', 'voice-samples');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, `eve-en-${createHash('sha256').update(text).digest('hex').slice(0, 12)}.mp3`), Buffer.from('ID3fake'));
  const ok = await get('/api/voice/xai-sample?voice=eve');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), 'ID3fake');
});

test('choosing a voice saves only the voice', async () => {
  const before = (await (await get('/api/voice')).json()).settings;
  const r = await fetch(base + '/api/voice', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ xai: { voiceId: 'luna' } }) });
  assert.equal(r.status, 200);
  const after = (await (await get('/api/voice')).json()).settings;
  assert.equal(after.xai.voiceId, 'luna');
  assert.equal(after.xai.language, before.xai.language);
  assert.equal(after.tts, before.tts);
});
