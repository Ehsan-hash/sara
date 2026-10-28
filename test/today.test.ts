// Phase 15: the Today page's summary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildToday, clearTodayCache } from '../src/today.ts';
import { makeApp, tempDir } from './helpers.ts';

test("today: greeting, what's due (overdue first), reminders in the next day, dates; no Google parts until connected", async (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-24T14:00:00Z') }; // 9 am in Chicago
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  clearTodayCache();
  app.settings.update({ ownerName: 'Alex', timeZone: 'America/Chicago' });
  const pl = app.planner!;
  pl.addTask({ title: 'Pay rent', dueAt: '2026-10-23T15:00:00Z' });
  pl.addTask({ title: 'Call the bank', dueAt: '2026-10-24T20:00:00Z' });
  pl.addTask({ title: 'Next week thing', dueAt: '2026-10-30T20:00:00Z' });
  pl.addTask({ title: 'Big one', priority: 'high' });
  pl.addTask({ title: 'Someday' });
  pl.addReminder({ text: 'Take meds', dueAt: '2026-10-24T22:00:00Z', repeat: 'none', conversationId: null });
  pl.addReminder({ text: 'Far away', dueAt: '2026-11-24T22:00:00Z', repeat: 'none', conversationId: null });
  app.memory!.add({ kind: 'date', content: "Mom's birthday", onDate: '10-26', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-01' });
  const d = await buildToday(app);
  assert.equal(d.greeting, 'Good morning, Alex');
  assert.equal(d.date, 'Saturday, October 24');
  assert.deepEqual(d.agenda.tasks.map((x) => [x.title, x.overdue]), [['Pay rent', true], ['Call the bank', false], ['Big one', false]]);
  assert.deepEqual(d.agenda.reminders.map((r) => r.text), ['Take meds']);
  assert.deepEqual(d.dates, [{ what: "Mom's birthday", inDays: 2, years: null }]);
  assert.equal(d.calendar, undefined);
  assert.equal(d.mail, undefined);
  assert.deepEqual(d.jobs, []);
});
