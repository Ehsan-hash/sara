import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eachDay } from '../src/range.js';
import { quote } from '../src/booking.js';
import { formatDate, parseDate } from '../src/dates.js';

test('round trip of a date', () => {
  assert.equal(formatDate(parseDate('2026-01-01')), '2026-01-01');
  assert.equal(formatDate(parseDate('2026-12-31')), '2026-12-31');
});
test('both ends included, across a month end', () => {
  assert.deepEqual(eachDay('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});
test('one day and an empty range', () => {
  assert.deepEqual(eachDay('2026-05-01', '2026-05-01'), ['2026-05-01']);
  assert.deepEqual(eachDay('2026-05-02', '2026-05-01'), []);
});
test('weekend nights', () => {
  // Thu 29, Fri 30, Sat 31 October, Sun 1 November 2026
  assert.deepEqual(quote('2026-10-29', '2026-11-02', 100, { weekendRate: 150 }), { nights: 4, total: 500 });
  assert.deepEqual(quote('2026-10-29', '2026-11-02', 100), { nights: 4, total: 400 });
  assert.deepEqual(quote('2026-10-30', '2026-10-31', 100, { weekendRate: 0 }), { nights: 1, total: 0 });
});
test('check-out must be after check-in', () => {
  assert.throws(() => quote('2026-10-29', '2026-10-29', 100));
  assert.throws(() => quote('2026-10-29', '2026-10-28', 100));
});
