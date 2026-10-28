// Phase 19: "Report this reply" and the developer's report inbox.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { ReportStore } from '../src/reports.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-24T12:00:00Z') };
const app = makeApp(dir, clock);
app.reports = new ReportStore(app.store.db, app.now);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
// One server is both: an owner's server, and (for the test) the developer's inbox it reports to.
let base = '';
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web'), reportInbox: true, get reportTo() { return `${base}/api/public/report`; } } as never);
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});
const call = (path: string, body?: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
  fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('report a reply: kept on the server, marked, and sent to the developer inbox (reply text, reason, note only)', async () => {
  const conv = app.store.createConversation({ title: 'Chat' });
  app.store.addMessage(conv.id, 'user', 'my secret question');
  const reply = app.store.addMessage(conv.id, 'assistant', 'A bad answer.', { model: 'm1' });
  assert.equal((await call('/api/reports', { conversationId: conv.id, messageId: reply.id, reason: 'nope' })).status, 400);
  const r = await call('/api/reports', { conversationId: conv.id, messageId: reply.id, reason: 'harmful', note: 'Told me something dangerous' }, { authorization: `Bearer ${token}`, 'user-agent': 'Mozilla/5.0 (iPhone) SaraPhone/1' });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { ok: true, sent: true });
  const view = await (await call('/api/reports')).json();
  assert.equal(view.reports.length, 1);
  assert.equal(view.reports[0].text, 'A bad answer.');
  assert.ok(view.reports[0].sentAt);
  assert.equal(view.inbox.length, 1);
  assert.deepEqual({ ...view.inbox[0], id: 0, receivedAt: '' }, { id: 0, text: 'A bad answer.', reason: 'harmful', note: 'Told me something dangerous', model: 'm1', platform: 'ios', appVersion: 'dev', receivedAt: '' });
  assert.doesNotMatch(JSON.stringify(view.inbox), /secret question/);
  assert.equal(app.store.messages(conv.id).find((m) => m.id === reply.id)!.meta?.reported, 'harmful');
  // Not sent when the owner unticks it.
  const r2 = await call('/api/reports', { conversationId: conv.id, messageId: reply.id, reason: 'other', toDeveloper: false });
  assert.deepEqual(await r2.json(), { ok: true, sent: false });
  assert.equal((await (await call('/api/reports')).json()).inbox.length, 1);
});

test('report inbox: public, but needs text and a reason, and is rate-limited per address', async () => {
  const pub = (body: unknown) => call('/api/public/report', body, {});
  assert.equal((await pub({ reason: 'harmful' })).status, 400);
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await pub({ text: `t${i}`, reason: 'other' })).status;
  assert.equal(last, 429);
});
