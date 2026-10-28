// Phase 18: messages sent from a notification's Reply box or the share sheet. The phone doesn't
// wait; her reply is published as a message event (so it becomes a notification) and shows up in
// the Android app's regular check.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import type { HubEvent } from '../src/events.ts';
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

test('background reply: 202 at once; her reply becomes a message event and is in the phone inbox', async () => {
  const conv = app.store.createConversation({ title: 'Chat' });
  const inbox0 = await (await call('/api/phone/inbox?after=0')).json();
  const events: HubEvent[] = [];
  const off = app.events!.subscribe((ev) => events.push(ev));
  app.script.push(text('On my way to the store now!'));
  const r = await call(`/api/conversations/${conv.id}/messages`, { content: 'Can you pick up milk?', background: true });
  assert.equal(r.status, 202);
  for (let i = 0; i < 50 && !events.some((e) => e.type === 'message'); i++) await new Promise((res) => setTimeout(res, 20));
  off();
  const ev = events.find((e) => e.type === 'message');
  assert.ok(ev && ev.type === 'message');
  assert.equal(ev.reason, 'reply');
  assert.equal(ev.conversationId, conv.id);
  assert.equal(ev.message.content, 'On my way to the store now!');
  const msgs = app.store.messages(conv.id);
  assert.deepEqual(msgs.filter((m) => m.role !== 'notice').map((m) => m.content), ['Can you pick up milk?', 'On my way to the store now!']);
  const inbox = await (await call(`/api/phone/inbox?after=${inbox0.latest}`)).json();
  assert.deepEqual(inbox.messages.map((m: { text: string }) => m.text), ['On my way to the store now!']);
});
