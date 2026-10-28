import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAmount, parseAmount } from '../src/core/money.js';

test('amounts in cents', () => {
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('-4.20'), -420);
  assert.equal(parseAmount('(12.00)'), -1200);
  assert.equal(parseAmount('$7'), 700);
  assert.equal(parseAmount('+3.05'), 305);
  assert.equal(parseAmount('1,234.50'), 123450);
});

test('bad amounts', () => {
  for (const s of ['', 'abc', '1.234', '12,34', '1,23.00', '--5', '5-']) assert.throws(() => parseAmount(s), /invalid amount/, s);
});

test('formatting', () => {
  assert.equal(formatAmount(-123450), '-1,234.50');
  assert.equal(formatAmount(5), '0.05');
  assert.equal(formatAmount(123456789, { grouping: false }), '1234567.89');
});
