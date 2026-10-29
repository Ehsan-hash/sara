// One local-day formatter (memory-worker.ts localDate): a time zone this Node doesn't know falls
// back to the UTC day instead of throwing on every turn (calls, daysKnown, notes).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CALL_RULES, inQuietHours } from '../src/calls.ts';
import { daysKnown } from '../src/chat.ts';
import { localDate } from '../src/memory-worker.ts';
import type { Store } from '../src/store.ts';

const BAD = 'Mars/Olympus_Mons';

test('local day: the owner\'s zone; a Date or an ISO string; a bad zone falls back to the UTC day', () => {
  const t = new Date('2026-10-29T03:30:00Z');
  assert.equal(localDate(t, 'America/Chicago'), '2026-10-28');
  assert.equal(localDate(t.toISOString(), 'Asia/Tokyo'), '2026-10-29');
  assert.equal(localDate(t, 'UTC'), '2026-10-29');
  assert.doesNotThrow(() => localDate(t, BAD));
  assert.equal(localDate(t, BAD), '2026-10-29');
  assert.equal(localDate('2026-10-29T03:30:00Z', BAD), '2026-10-29');
  assert.equal(localDate(new Date(Number.NaN), BAD), '');
});

test('local day: daysKnown and quiet hours survive a bad zone', () => {
  const store = { firstOwnerMessageAt: () => new Date('2026-10-20T12:00:00Z') } as unknown as Store;
  const now = new Date('2026-10-29T12:00:00Z');
  assert.equal(daysKnown(store, now, BAD), 9);
  assert.equal(daysKnown(store, now, 'Europe/Berlin'), 9);
  const rules = { ...DEFAULT_CALL_RULES, quietStart: '22:00', quietEnd: '07:00' };
  assert.equal(inQuietHours(rules, new Date('2026-10-29T23:30:00Z'), BAD), true, 'UTC 23:30 is in 22:00-07:00');
  assert.equal(inQuietHours(rules, now, BAD), false);
});
