import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNumber, leadingNumber } from '../src/numbers.js';

test('leading numbers', () => {
  assert.deepEqual(leadingNumber('12 kg'), { value: 12, rest: ' kg' });
  assert.equal(leadingNumber('.5l').value, 0.5);
  assert.equal(leadingNumber('-1 1/2 in').value, -1.5);
  assert.equal(leadingNumber('kg'), undefined);
});

test('formatting numbers', () => {
  assert.equal(formatNumber(1234567.891, 2), '1,234,567.89');
  assert.equal(formatNumber(2.5, 0), '3');
  assert.equal(formatNumber(-0.004, 2), '0');
  assert.equal(formatNumber(10, 2), '10');
});
