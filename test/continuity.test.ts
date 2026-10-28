// Pick up anywhere: every turn tells the other open apps (phone, desktop, another browser) that a
// conversation moved on, so they refresh it. Off-the-record conversations stay on one device.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import type { HubEvent } from '../src/events.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir, text } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-26T12:00:00Z') };
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
let base = '';
before(async () => {
  app.settings.update({ disclosureAcceptedAt: '2026-10-24T00:00:00Z', providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});
const call = (path: string, body?: unknown) =>
  fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const turns = (events: HubEvent[]) => events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? `${e.conversationId}:${e.state}` : ''));

test('continuity: a turn publishes started and ended for the conversation', async () => {
  const conv = app.store.createConversation({ title: 'Chat' });
  const events: HubEvent[] = [];
  const off = app.events!.subscribe((ev) => events.push(ev));
  app.script.push(text('Hello from the server.'));
  const r = await call(`/api/conversations/${conv.id}/messages`, { content: 'Hi' });
  await r.text();
  off();
  assert.deepEqual(turns(events), [`${conv.id}:started`, `${conv.id}:ended`]);
});

test('continuity: the conversation list and history are the same for every device', async () => {
  const listed = (await (await call('/api/conversations')).json()) as { id: string; title: string }[];
  assert.ok(listed.some((c) => c.title === 'Chat'));
  const phone = await fetch(`${base}/api/conversations/${listed[0].id}?limit=50`, { headers: { authorization: `Bearer ${token}`, 'user-agent': 'SaraPhone/1 (iPhone)' } });
  const conv = (await phone.json()) as { messages: { role: string; content: string }[] };
  assert.deepEqual(conv.messages.filter((m) => m.role !== 'notice').map((m) => m.content), ['Hi', 'Hello from the server.']);
});

test('continuity: off-the-record turns are not announced to other devices', async () => {
  const r = await call('/api/conversations', { title: 'Secret', private: true, offRecord: true });
  const conv = (await r.json()) as { id: string; offRecord?: boolean };
  const events: HubEvent[] = [];
  const off = app.events!.subscribe((ev) => events.push(ev));
  app.script.push(text('Only here.'));
  await (await call(`/api/conversations/${conv.id}/messages`, { content: 'Psst' })).text();
  off();
  assert.equal(conv.offRecord, true);
  assert.deepEqual(turns(events), []);
});
