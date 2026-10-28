// Phase 14: what the phone app's widget and notification check get from the server.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-24T12:00:00Z') };
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
let base = '';
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});
const get = async (p: string) => (await fetch(base + p, { headers: { authorization: `Bearer ${token}` } })).json();

test('phone: widget shows her name, face and last message; inbox lists only messages she sent on her own', async () => {
  assert.equal((await fetch(`${base}/api/phone/widget`)).status, 401, 'owner only');
  const conv = app.store.createConversation();
  app.store.addMessage(conv.id, 'user', 'hi');
  const reply = app.store.addMessage(conv.id, 'assistant', 'Hey you.');
  const start = await get('/api/phone/inbox?after=0');
  assert.deepEqual(start.messages, [], 'normal replies are not notifications');
  const r = app.store.addMessage(conv.id, 'assistant', 'Reminder: call mom', { reminder: { id: 1 } });
  const p = app.store.addMessage(conv.id, 'assistant', 'Thinking of you!', { proactive: { reason: 'miss' } });
  const partner = app.store.createConversation({ channel: 'telegram', partner: 'Alex' });
  app.store.addMessage(partner.id, 'assistant', 'Nice to meet you, Alex', { proactive: { reason: 'x' } });
  const inbox = await get(`/api/phone/inbox?after=${reply.id}`);
  assert.deepEqual(inbox.messages.map((m: { id: number; kind: string }) => [m.id, m.kind]), [[r.id, 'reminder'], [p.id, 'message']]);
  assert.equal((await get(`/api/phone/inbox?after=${p.id}`)).messages.length, 0);
  const w = await get('/api/phone/widget');
  assert.equal(w.name, 'Sara');
  assert.match(w.face, /^\/sara(-portrait|\/portrait-\w+)\.jpg$/);
  assert.equal(w.last.text, 'Thinking of you!', "a partner's chat never shows on the widget");
});
