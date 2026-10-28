import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, monthRange, parseDate } from '../src/core/dates.js';

test('dates', () => {
  assert.equal(parseDate('today', '2026-03-01'), '2026-03-01');
  assert.equal(parseDate('yesterday', '2026-03-01'), '2026-02-28');
  assert.equal(parseDate('-7d', '2026-03-01'), '2026-02-22');
  assert.equal(parseDate('2024-02-29', '2026-03-01'), '2024-02-29');
  assert.throws(() => parseDate('2026-02-30', '2026-03-01'), /invalid date/);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('months', () => {
  assert.deepEqual(monthRange('2026-02'), { first: '2026-02-01', last: '2026-02-28' });
  assert.deepEqual(monthRange('2026-12'), { first: '2026-12-01', last: '2026-12-31' });
  assert.throws(() => monthRange('2026-13'), /invalid month/);
});
