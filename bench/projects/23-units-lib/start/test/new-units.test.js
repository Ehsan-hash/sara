import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convert, format, parse } from '../src/index.js';

test('nautical miles', () => {
  assert.deepEqual(parse('3 nmi'), { value: 3, unit: 'nmi' });
  assert.equal(convert(1, 'nmi', 'm'), 1852);
  assert.equal(format({ value: 2, unit: 'nmi' }), '2 nautical miles');
});

test('stone', () => {
  assert.deepEqual(parse('11 stone'), { value: 11, unit: 'st' });
  assert.ok(Math.abs(convert(1, 'st', 'lb') - 14) < 1e-9);
  assert.equal(format({ value: 11, unit: 'st' }), '11 stone');
});

test('cups', () => {
  assert.deepEqual(parse('1.5 cups'), { value: 1.5, unit: 'cup' });
  assert.ok(Math.abs(convert(2, 'cup', 'ml') - 473.176473) < 1e-6);
});
