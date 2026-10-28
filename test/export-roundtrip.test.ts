// Export/import round trips: conversation flags (private, partner, project, archived), no duplicates
// on a second import, outdated notes stay outdated, call and place reminders survive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportAll, importAll } from '../src/export.ts';
import { makeApp, tempDir, type TestApp } from './helpers.ts';

function mk(t: { after: (fn: () => void) => void }): TestApp {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  return app;
}

const roundTrip = (a: TestApp, b: TestApp) => importAll(b, JSON.parse(JSON.stringify(exportAll(a))));

test('conversation flags survive: private + archived, partner chat, project-filed', (t) => {
  const a = mk(t);
  const secret = a.store.createConversation({ title: 'Secret', private: true });
  a.store.updateConversation(secret.id, { archived: true });
  const partner = a.store.createConversation({ title: 'Ana on Telegram', channel: 'telegram', channelKey: '4242', partner: 'Ana' });
  // Make project ids differ on the target so the remap matters.
  const b = mk(t);
  b.planner!.projectId('Other');
  b.planner!.projectId('Another');
  const pid = a.planner!.projectId('Garden')!;
  const filed = a.store.createConversation({ title: 'Tomatoes', projectId: pid });
  const plain = a.store.createConversation({ title: 'Plain' });

  const r = roundTrip(a, b);
  assert.equal(r.conversations, 4);
  const s = b.store.getConversation(secret.id)!;
  assert.equal(s.private, true, 'private stays private');
  assert.equal(s.archivedAt, a.store.getConversation(secret.id)!.archivedAt);
  assert.notEqual(s.archivedAt, null);
  const p = b.store.getConversation(partner.id)!;
  assert.equal(p.partner, 'Ana', 'partner chat is not turned into an owner chat');
  assert.equal(p.channel, 'telegram');
  assert.equal(p.channelKey, '4242');
  assert.equal(b.store.findChannelConversation('telegram', '4242', 'partner')?.id, partner.id);
  const f = b.store.getConversation(filed.id)!;
  const garden = b.planner!.projects(true).find((x) => x.name === 'Garden')!;
  assert.notEqual(garden.id, pid, 'ids differ, so this checks the remap');
  assert.equal(f.projectId, garden.id);
  const q = b.store.getConversation(plain.id)!;
  assert.equal(q.private, false);
  assert.equal(q.partner, null);
  assert.equal(q.archivedAt, null);
  assert.equal(q.channel, 'web');
});

test('older export files (without the new fields) still import with safe defaults', (t) => {
  const b = mk(t);
  const r = importAll(b, {
    format: 'sara-export',
    version: 1,
    exportedAt: '2026-01-01T00:00:00Z',
    owner: {},
    conversations: [{ id: 'old-1', title: 'Old', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', messages: [{ id: 1, role: 'user', content: 'hi', created_at: '2026-01-01T00:00:00Z' }] }],
    memories: [{ id: 1, kind: 'fact', content: 'Old fact', conversation_id: null, happened_on: '2026-01-01' }],
    memoryState: [],
    projects: [],
    tasks: [],
    notes: [],
    reminders: [{ id: 1, text: 'old one', due_at: '2026-11-01T10:00:00Z', repeat: 'none', status: 'pending', created_at: '2026-01-01T00:00:00Z' }],
  });
  assert.equal(r.conversations, 1);
  assert.equal(r.memories, 1);
  assert.equal(r.reminders, 1);
  const c = b.store.getConversation('old-1')!;
  assert.equal(c.private, false);
  assert.equal(c.partner, null);
  assert.equal(c.channel, 'web');
  assert.equal(b.memory!.list({ kind: 'fact' })[0].supersededBy, null);
  const rem = b.planner!.reminders()[0];
  assert.equal(rem.call, false);
  assert.equal(rem.placeId, null);
});

test('importing the same file twice adds nothing the second time', (t) => {
  const a = mk(t);
  a.memory!.add({ kind: 'fact', content: 'Alex likes tea.', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-24' });
  a.memory!.add({ kind: 'date', content: "Alex's birthday", conversationId: null, sourceMessageId: null, happenedOn: '2026-10-24', onDate: '1990-05-01' });
  a.planner!.addTask({ title: 'Buy tea', project: 'Home', dueAt: '2026-10-30T17:00:00.000Z' });
  a.planner!.addTask({ title: 'Call mom' });
  a.planner!.saveNote({ title: 'Vet', body: 'Dr. Lee' });
  a.planner!.addReminder({ text: 'stretch', dueAt: '2026-10-25T15:00:00.000Z', repeat: 'daily' });
  const home = a.planner!.savePlace({ name: 'Home', lat: 41.88, lon: -87.63 });
  a.planner!.addReminder({ text: 'water plants', dueAt: '', place: { id: home.id, event: 'arrive' } });
  const file = JSON.stringify(exportAll(a));

  const b = mk(t);
  const first = importAll(b, JSON.parse(file));
  assert.deepEqual([first.memories, first.tasks, first.notes, first.reminders, first.places, first.projects], [2, 2, 1, 2, 1, 1]);
  const second = importAll(b, JSON.parse(file));
  assert.deepEqual([second.memories, second.tasks, second.notes, second.reminders, second.places, second.projects], [0, 0, 0, 0, 0, 0]);
  assert.equal(b.memory!.listAll().length, 2);
  assert.equal(b.planner!.tasks().length, 2);
  assert.equal(b.planner!.notes().length, 1);
  assert.equal(b.planner!.reminders().length, 2, 'reminders would fire twice if duplicated');
  assert.equal(b.planner!.places().length, 1);
  // Importing back into the source adds nothing either.
  const self = importAll(a, JSON.parse(file));
  assert.deepEqual([self.memories, self.tasks, self.notes, self.reminders, self.places], [0, 0, 0, 0, 0]);
});

test('notes marked outdated stay outdated (remapped), mentioned_on comes along', (t) => {
  const a = mk(t);
  const old = a.memory!.add({ kind: 'fact', content: 'Alex lives in Austin.', conversationId: null, sourceMessageId: null, happenedOn: '2026-01-01' });
  const neu = a.memory!.add({ kind: 'fact', content: 'Alex lives in Chicago.', conversationId: null, sourceMessageId: null, happenedOn: '2026-06-01' });
  a.memory!.supersede(old.id, neu.id);
  a.memory!.markMentioned(neu.id, '2026-10-20');
  const b = mk(t);
  // Shift memory ids on the target.
  b.memory!.add({ kind: 'fact', content: 'Something else.', conversationId: null, sourceMessageId: null, happenedOn: '2026-01-01' });
  b.memory!.add({ kind: 'fact', content: 'And another.', conversationId: null, sourceMessageId: null, happenedOn: '2026-01-01' });
  roundTrip(a, b);
  const all = b.memory!.listAll();
  const bOld = all.find((m) => m.content === 'Alex lives in Austin.')!;
  const bNew = all.find((m) => m.content === 'Alex lives in Chicago.')!;
  assert.equal(bOld.supersededBy, bNew.id, 'still outdated, pointing at the remapped newer note');
  assert.equal(bNew.supersededBy, null);
  assert.equal(bNew.mentionedOn, '2026-10-20');
});

test('call reminders stay calls; place reminders keep their (remapped) place', (t) => {
  const a = mk(t);
  a.planner!.addReminder({ text: 'call me about dinner', dueAt: '2026-10-25T22:00:00.000Z', call: true });
  const store = a.planner!.savePlace({ name: 'Store', lat: 41.9, lon: -87.6, radius: 200 });
  a.planner!.addReminder({ text: 'buy milk', dueAt: '', place: { id: store.id, event: 'leave' } });
  const b = mk(t);
  b.planner!.savePlace({ name: 'Work', lat: 41.8, lon: -87.7 });
  b.planner!.savePlace({ name: 'Gym', lat: 41.7, lon: -87.7 });
  const r = roundTrip(a, b);
  assert.equal(r.reminders, 2);
  assert.equal(r.places, 1);
  const rems = b.planner!.reminders();
  const callRem = rems.find((x) => x.text === 'call me about dinner')!;
  assert.equal(callRem.call, true);
  const placeRem = rems.find((x) => x.text === 'buy milk')!;
  const bStore = b.planner!.placeByName('Store')!;
  assert.notEqual(bStore.id, store.id, 'ids differ, so this checks the remap');
  assert.equal(placeRem.placeId, bStore.id);
  assert.equal(placeRem.placeEvent, 'leave');
  assert.equal(bStore.radius, 200);
  assert.equal(b.planner!.placeReminders(bStore.id, 'leave').length, 1);
});

test('L10: team limits (with the dollar budget) and the job budget travel with the export', (t) => {
  const a = mk(t);
  a.settings.update({ teamLimits: { minutes: 45, tokens: 900_000, steps: 12, usd: 7.5 }, jobBudget: { tokens: 200_000, usd: 2 } });
  const file = JSON.parse(JSON.stringify(exportAll(a)));
  assert.deepEqual(file.teamLimits, { minutes: 45, tokens: 900_000, steps: 12, usd: 7.5 });
  const b = mk(t);
  importAll(b, file);
  assert.deepEqual(b.settings.get().teamLimits, { minutes: 45, tokens: 900_000, steps: 12, usd: 7.5 });
  assert.deepEqual(b.settings.get().jobBudget, { tokens: 200_000, usd: 2 });
  // A server with its own team limits keeps them.
  const c = mk(t);
  c.settings.update({ teamLimits: { minutes: 10, tokens: 50_000, steps: 4 } });
  importAll(c, file);
  assert.deepEqual(c.settings.get().teamLimits, { minutes: 10, tokens: 50_000, steps: 4 });
});
