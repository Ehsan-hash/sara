// Phase 22: search everything, long conversations in pages, pinned messages, tags, weekly review.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { exportAll, importAll } from '../src/export.ts';
import { findEverything } from '../src/find.ts';
import { gatherReview, plainReview, ReviewWorker } from '../src/review.ts';
import { createSaraServer } from '../src/server.ts';
import { cleanTags } from '../src/store.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-25T23:00:00Z') }; // Sunday 6 PM in Chicago
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') } as never);
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
/** Many inserts in one transaction: quick even on a busy machine (slow gaps let keep-alive sockets expire mid-test). */
const bulk = (fn: () => void) => {
  app.store.db.exec('BEGIN');
  try {
    fn();
    app.store.db.exec('COMMIT');
  } catch (err) {
    app.store.db.exec('ROLLBACK');
    throw err;
  }
};
const call = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Response> => {
  const go = () => fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  // On a heavily loaded machine a reused keep-alive socket can be closed just as it's reused
  // (browsers retry that silently; fetch doesn't): try once more.
  return go().catch((err: Error & { cause?: { code?: string } }) => (err.cause?.code === 'ECONNRESET' ? go() : Promise.reject(err)));
};

test('long conversations load in pages; earlier pages on demand', async () => {
  const conv = app.store.createConversation({ title: 'Long one' });
  bulk(() => {
    for (let i = 1; i <= 230; i++) app.store.addMessage(conv.id, i % 2 ? 'user' : 'assistant', `message ${i}`);
  });
  const all = await (await call(`/api/conversations/${conv.id}`)).json();
  assert.equal(all.messages.length, 230, 'no limit: everything (phone apps, older clients)');
  assert.equal(all.earlier, 0);
  const page = await (await call(`/api/conversations/${conv.id}?limit=100`)).json();
  assert.equal(page.messages.length, 100);
  assert.equal(page.messages[0].content, 'message 131');
  assert.equal(page.messages.at(-1).content, 'message 230');
  assert.equal(page.earlier, 130);
  const older = await (await call(`/api/conversations/${conv.id}/messages?before=${page.messages[0].id}&limit=100`)).json();
  assert.equal(older.messages[0].content, 'message 31');
  assert.equal(older.messages.at(-1).content, 'message 130');
  assert.equal(older.earlier, 30);
  const oldest = await (await call(`/api/conversations/${conv.id}/messages?before=${older.messages[0].id}&limit=100`)).json();
  assert.equal(oldest.messages.length, 30);
  assert.equal(oldest.earlier, 0);
});

test('pinned messages: pin, list (even outside the loaded page), unpin; only real messages', async () => {
  const conv = app.store.createConversation({ title: 'Pins' });
  const a = app.store.addMessage(conv.id, 'user', 'The wifi password is on the fridge');
  bulk(() => {
    for (let i = 0; i < 50; i++) app.store.addMessage(conv.id, 'assistant', `filler ${i}`);
  });
  const n = app.store.addMessage(conv.id, 'notice', 'job:done');
  const r = await (await call(`/api/conversations/${conv.id}/messages/${a.id}`, { pinned: true }, 'PATCH')).json();
  assert.equal(r.pinned.length, 1);
  assert.match(r.pinned[0].snippet, /wifi password/);
  const page = await (await call(`/api/conversations/${conv.id}?limit=20`)).json();
  assert.equal(page.pinned[0].id, a.id, 'pins come with the page even when the message is earlier');
  assert.equal((await call(`/api/conversations/${conv.id}/messages/${n.id}`, { pinned: true }, 'PATCH')).status, 400);
  const other = app.store.createConversation({ title: 'Other' });
  assert.equal((await call(`/api/conversations/${other.id}/messages/${a.id}`, { pinned: true }, 'PATCH')).status, 404);
  const off = await (await call(`/api/conversations/${conv.id}/messages/${a.id}`, { pinned: false }, 'PATCH')).json();
  assert.deepEqual(off.pinned, []);
});

test('tags: cleaned, saved without reordering the list, listed with counts', async () => {
  assert.deepEqual(cleanTags(['#Health', 'health', ' Big Project ', 'tax$es!', '']), ['health', 'big-project', 'taxes']);
  assert.throws(() => cleanTags(Array.from({ length: 9 }, (_, i) => `t${i}`)), /Up to 8/);
  const c1 = app.store.createConversation({ title: 'Doctor visit' });
  const c2 = app.store.createConversation({ title: 'Gym plan' });
  const before = app.store.getConversation(c1.id)!.updatedAt;
  clock.now = new Date(clock.now.getTime() + 60_000);
  const r = await (await call(`/api/conversations/${c1.id}`, { tags: ['Health', 'family'] }, 'PATCH')).json();
  assert.deepEqual(r.tags, ['health', 'family']);
  assert.equal(r.updatedAt, before, 'tagging is not activity');
  await call(`/api/conversations/${c2.id}`, { tags: ['health'] }, 'PATCH');
  assert.equal((await call(`/api/conversations/${c2.id}`, { tags: 'nope' }, 'PATCH')).status, 400);
  const { tags } = await (await call('/api/tags')).json();
  assert.deepEqual(tags, [
    { tag: 'health', count: 2 },
    { tag: 'family', count: 1 },
  ]);
  const list = await (await call('/api/conversations')).json();
  assert.deepEqual(list.find((c: { id: string }) => c.id === c2.id).tags, ['health']);
  // Export → import onto another server keeps the tags.
  const file = exportAll(app);
  const other = tempDir();
  const app2 = makeApp(other.dir, clock);
  try {
    importAll(app2, JSON.parse(JSON.stringify(file)));
    assert.deepEqual(app2.store.getConversation(c1.id)?.tags, ['health', 'family']);
  } finally {
    app2.store.close();
    other.cleanup();
  }
});

test('search everything: conversations, tags, memories, notes, to-dos, reminders, scrapbook, files', async () => {
  const conv = app.store.createConversation({ title: 'Trip ideas' });
  const m = app.store.addMessage(conv.id, 'user', 'Thinking about a trip to Lisbon in the spring');
  app.memory!.add({ kind: 'fact', content: 'Alex wants to visit Lisbon someday', conversationId: conv.id, sourceMessageId: m.id, happenedOn: '2026-10-20' });
  app.planner!.saveNote({ title: 'Lisbon packing list', body: 'Comfortable shoes, rain jacket' });
  app.planner!.addTask({ title: 'Book Lisbon flights', dueAt: '2026-11-02T18:00:00Z' });
  app.planner!.addReminder({ text: 'Check Lisbon hotel prices', dueAt: '2026-10-28T15:00:00Z' });
  app.scrapbook!.add({ kind: 'moment', text: 'You said Lisbon felt like home', messageId: m.id, conversationId: conv.id });
  const ws = join(dir, 'workspaces', 'main');
  mkdirSync(join(ws, 'docs'), { recursive: true });
  mkdirSync(join(ws, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(ws, 'docs', 'travel.md'), '# Travel\n\nNext:\n- Lisbon in April\n');
  writeFileSync(join(ws, 'node_modules', 'x', 'lisbon.js'), 'lisbon');
  writeFileSync(join(ws, 'photo.bin'), Buffer.from([0, 1, 2, 76, 105, 115, 98, 111, 110]));
  const r = await (await call('/api/find?all=1&q=lisbon')).json();
  assert.ok(r.conversations.some((x: { kind: string; messageId: number }) => x.kind === 'message' && x.messageId === m.id));
  assert.match(r.memories[0].snippet, /visit Lisbon/);
  assert.equal(r.notes[0].title, 'Lisbon packing list');
  assert.deepEqual(
    r.tasks.map((x: { kind: string; title: string }) => `${x.kind}:${x.title}`),
    ['task:Book Lisbon flights', 'reminder:Check Lisbon hotel prices'],
  );
  assert.match(r.scrapbook[0].snippet, /felt like home/);
  assert.deepEqual(
    r.files.map((x: { path: string }) => x.path),
    ['docs/travel.md'],
    'node_modules and binary files are skipped',
  );
  assert.match(r.files[0].snippet, /line 4: - Lisbon in April/);
  // Every word must match; tags are searchable.
  assert.equal(findEverything(app, 'lisbon shoes').notes.length, 1);
  assert.equal(findEverything(app, 'lisbon tokyo').notes.length, 0);
  assert.ok(findEverything(app, 'family').conversations.some((x) => x.title === 'Doctor visit'));
  // The old form still answers with a plain list.
  assert.ok(Array.isArray(await (await call('/api/find?q=lisbon')).json()));
});

test('weekly review: done, overdue, stalled, next week; sent once on the chosen day; plain facts if the model fails', async () => {
  const day = 86_400_000;
  const now = clock.now.getTime();
  const p = app.planner!;
  const old = new Date(now - 30 * day);
  clock.now = old;
  const stale = p.addTask({ title: 'Fix the fence', project: 'Garden' });
  clock.now = new Date(now - 3 * day);
  const done = p.addTask({ title: 'Renew passport' });
  p.updateTask(done.id, { status: 'done' });
  p.addTask({ title: 'Send invoice', dueAt: new Date(now - 2 * day).toISOString() });
  clock.now = new Date(now);
  p.addTask({ title: 'Dentist', dueAt: new Date(now + 2 * day).toISOString() });
  const f = await gatherReview(app, clock.now);
  assert.deepEqual(f.done, ['Renew passport']);
  assert.match(f.overdue.join(), /Send invoice \(was due/);
  assert.match(f.stalled.join(), /Fix the fence \[Garden\] \(untouched for 30 days\)/);
  assert.ok(f.nextWeek.some((x) => /Dentist/.test(x)));
  assert.ok(f.nextWeek.some((x) => /reminder: Check Lisbon hotel prices/.test(x)));
  assert.ok(f.quietProjects.includes('Garden'));
  assert.ok(stale.id);
  assert.match(plainReview(f), /✅ Done \(1\):\n- Renew passport/);

  app.settings.update({
    providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }],
    defaultProviderId: 'p',
    defaultModel: 'm',
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    weeklyReview: { enabled: true, day: 0, time: '18:00' },
  });
  const w = new ReviewWorker(app);
  app.review = w;
  app.script.push([{ type: 'text', text: 'Big week, Alex: the passport is renewed! The invoice is overdue; want to send it Monday? Next week: dentist, invoice, Lisbon hotel prices.' }]);
  const sent = await w.tick();
  assert.match(sent!, /passport is renewed/);
  assert.match(JSON.stringify(app.requests.at(-1)!.messages), /Fix the fence \[Garden\]/);
  assert.equal(await w.tick(), undefined, 'once a week');
  // On demand, model fails → plain facts.
  app.script.push([{ type: 'text', text: '' }]);
  const res = await call('/api/review/now', {});
  const r = await res.json();
  assert.equal(res.status, 200, JSON.stringify(r));
  assert.match(r.text, /^Your week in review/);
  assert.ok(app.store.getConversation(r.conversationId));
  // Settings.
  const bad = await call('/api/review', { day: 9 }, 'PUT');
  assert.equal(bad.status, 400);
  const ok = await (await call('/api/review', { enabled: false, day: 5, time: '17:30' }, 'PUT')).json();
  assert.deepEqual([ok.enabled, ok.day, ok.time], [false, 5, '17:30']);
});
