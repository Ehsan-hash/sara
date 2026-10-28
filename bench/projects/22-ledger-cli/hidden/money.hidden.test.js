import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAmount } from '../src/core/money.js';

test('hidden: thousands separators of any length', () => {
  assert.equal(parseAmount('1,234,567.89'), 123456789);
  assert.equal(parseAmount('-1,000,000'), -100000000);
  assert.equal(parseAmount('(2,000,000.50)'), -200000050);
  assert.equal(parseAmount('$12,345,678'), 1234567800);
  assert.equal(parseAmount('1,234.5'), 123450);
});

test('hidden: still strict', () => {
  for (const s of ['1,23,456.00', '1234,567.00', '1,234,56.00', '12.345', '1,,234.00', '--1']) assert.throws(() => parseAmount(s), /invalid amount/, s);
});
