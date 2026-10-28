import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convert, format, formatSplit } from '../src/index.js';

test('long and short style', () => {
  assert.equal(format({ value: 2, unit: 'km' }), '2 kilometres');
  assert.equal(format({ value: 1, unit: 'km' }), '1 kilometre');
  assert.equal(format({ value: 2, unit: 'km' }, { style: 'short' }), '2 km');
  assert.equal(format({ value: 1, unit: 'ft' }), '1 foot');
  assert.equal(format({ value: 3, unit: 'ft' }), '3 feet');
  assert.equal(format({ value: 21.5, unit: 'C' }), '21.5 degrees Celsius');
});

test('rounding per unit, grouping, the option', () => {
  assert.equal(format({ value: 1250.456, unit: 'm' }), '1,250.46 metres');
  assert.equal(format({ value: 12.345, unit: 'mm' }), '12 millimetres');
  assert.equal(format({ value: 0.9999, unit: 'kg' }), '1 kilogram');
  assert.equal(format({ value: 2.5, unit: 'g' }, { decimals: 0 }), '3 grams');
  assert.equal(format({ value: -0.001, unit: 'm' }), '0 metres');
});

test('split', () => {
  assert.equal(formatSplit(1.75, ['ft', 'in'], convert), '1 ft 9 in');
  assert.equal(formatSplit(2.5, ['lb', 'oz'], convert), '2 lb 8 oz');
});

test('errors', () => {
  assert.throws(() => format({ value: 1, unit: 'zz' }), /Unknown unit/);
  assert.throws(() => format({ value: NaN, unit: 'm' }), /finite/);
});
