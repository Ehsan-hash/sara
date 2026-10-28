// Phase 6: her picture follows her mood; the owner can use their own picture (validated, owner only).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { expressionFor, type InnerState } from '../src/inner.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const base: InnerState = { valence: 0.35, closeness: 0.5, concern: 0, irritation: 0, tension: 0, tensionAbout: null, tensionAt: null, causes: [], updatedAt: '', lastOwnerAt: null, lastProactiveAt: null, proactiveDay: null, proactiveCount: 0 };
const at = (h: number) => new Date(Date.UTC(2026, 9, 24, h, 30));

test('expressionFor: caring beats everything, sleepy in the small hours, happy when she is up', () => {
  assert.equal(expressionFor(base, at(15), 'UTC'), 'default');
  assert.equal(expressionFor({ ...base, valence: 0.7 }, at(15), 'UTC'), 'happy');
  assert.equal(expressionFor({ ...base, valence: 0.7, irritation: 0.5 }, at(15), 'UTC'), 'hurt', 'not beaming while annoyed: the hurt face (Phase 36)');
  assert.equal(expressionFor({ ...base, valence: 0.7 }, at(3), 'UTC'), 'sleepy');
  assert.equal(expressionFor({ ...base, concern: 0.6 }, at(3), 'UTC'), 'caring');
  assert.equal(expressionFor({ ...base, concern: 0.42 }, at(15), 'UTC'), 'caring', 'matches the mood line ("worried about you" from 0.4)');
  assert.equal(expressionFor(base, at(8), 'America/Chicago'), 'sleepy', '03:30 in Chicago');
});

test('avatar API: expression in state, upload checks the file type, owner only, reset', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { authorization: `Bearer ${auth.newToken}` };
  const st = await (await fetch(`${url}/sara/state`, { headers: H })).json();
  assert.ok(['default', 'happy', 'caring', 'sleepy', 'hurt', 'playful'].includes(st.expression));
  assert.equal(st.customAvatar, false);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);
  assert.equal((await fetch(`${url}/sara/avatar`, { method: 'PUT', body: png })).status, 401);
  assert.equal((await fetch(`${url}/sara/avatar`, { method: 'PUT', headers: H, body: Buffer.from('<svg onload=alert(1)>') })).status, 400, 'only real images');
  assert.equal((await fetch(`${url}/sara/avatar`, { method: 'PUT', headers: H, body: png })).status, 200);
  assert.ok(existsSync(join(dir, 'avatar.png')));
  const img = await fetch(`${url}/sara/avatar`, { headers: H });
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await img.arrayBuffer()).byteLength, png.length);
  assert.equal((await (await fetch(`${url}/sara/state`, { headers: H })).json()).customAvatar, true);
  // Too big: refused (413, or the connection is cut before the upload finishes).
  const big = await fetch(`${url}/sara/avatar`, { method: 'PUT', headers: H, body: Buffer.alloc(6 * 1024 * 1024, 0xff) }).then((r) => r.status, () => 413);
  assert.equal(big, 413);
  assert.equal((await (await fetch(`${url}/sara/state`, { headers: H })).json()).customAvatar, true, 'previous picture kept');
  await fetch(`${url}/sara/avatar`, { method: 'DELETE', headers: H });
  assert.equal((await fetch(`${url}/sara/avatar`, { headers: H })).status, 404);
  for (const f of ['sara/avatar-happy.jpg', 'sara/portrait-sleepy.jpg', 'sara/avatar-caring.jpg']) assert.equal((await fetch(`${url.replace('/api', '')}/${f}`)).status, 200, f);
});
