import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eachDay } from '../src/range.js';
import { quote } from '../src/booking.js';

test('three days', () => {
  assert.deepEqual(eachDay('2026-06-01', '2026-06-03'), ['2026-06-01', '2026-06-02', '2026-06-03']);
});

test('a two-night stay', () => {
  assert.deepEqual(quote('2026-06-01', '2026-06-03', 80), { nights: 2, total: 160 });
});
