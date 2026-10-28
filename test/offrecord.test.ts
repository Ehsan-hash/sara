// Phase 14: off-the-record conversations are never written to disk.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir, text } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-24T12:00:00Z') };
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
let base = '';

before(async () => {
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'UTC', disclosureAcceptedAt: clock.now.toISOString(), memory: { enabled: true } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});

const call = (path: string, opts: { method?: string; body?: unknown } = {}) =>
  fetch(base + path, { method: opts.method ?? 'GET', headers: { authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });

test('off the record: chat works, the safety layer still applies, nothing reaches the database', async () => {
  // A normal conversation first, so the real database has history.
  const normal = await (await call('/api/conversations', { method: 'POST', body: {} })).json();
  app.script.push(text('Hi Alex!'));
  await (await call(`/api/conversations/${normal.id}/messages`, { method: 'POST', body: { content: 'hello' } })).text();

  const off = await (await call('/api/conversations', { method: 'POST', body: { offRecord: true } })).json();
  assert.equal(off.offRecord, true);
  app.script.push(text('Your secret is safe with me.'));
  const sse = await (await call(`/api/conversations/${off.id}/messages`, { method: 'POST', body: { content: 'my secret: I hate pineapple pizza' } })).text();
  assert.match(sse, /Your secret is safe with me/);
  // No tools offered to the model here; memory notes aren't added to the prompt.
  const req = app.requests.at(-1)!;
  assert.equal(req.tools?.length ?? 0, 0);
  // The conversation shows up (marked) and can be read back while it's open.
  const list = await (await call('/api/conversations')).json();
  assert.equal(list.find((c: { id: string }) => c.id === off.id)?.offRecord, true);
  const got = await (await call(`/api/conversations/${off.id}`)).json();
  assert.deepEqual(got.messages.filter((m: { role: string }) => m.role !== 'notice').map((m: { content: string }) => m.content), ['my secret: I hate pineapple pizza', 'Your secret is safe with me.']);
  // Nothing of it is in the real database file.
  const dump = JSON.stringify(app.store.db.prepare("SELECT * FROM messages").all()) + JSON.stringify(app.store.db.prepare('SELECT * FROM conversations').all());
  assert.doesNotMatch(dump, /pineapple|safe with me/);
  assert.equal(app.store.getConversation(off.id), undefined);
  // Photos would be saved, so they're refused.
  const photo = await call(`/api/conversations/${off.id}/messages`, { method: 'POST', body: { content: 'look', images: ['data:image/png;base64,iVBORw0KGgo='] } });
  assert.equal(photo.status, 400);
  // Crisis help still works off the record.
  app.script.push(text("I'm here with you."));
  const crisis = await (await call(`/api/conversations/${off.id}/messages`, { method: 'POST', body: { content: 'I want to kill myself' } })).text();
  assert.match(crisis, /988/);
  // Closing it: gone for good.
  assert.equal((await call(`/api/conversations/${off.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/conversations/${off.id}`)).status, 404);
});
