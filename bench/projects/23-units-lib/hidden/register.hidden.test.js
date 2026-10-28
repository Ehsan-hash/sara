import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, convert, format, parse, registerUnit, sum, unitsOf, UnitError } from '../src/index.js';

test('hidden: a registered unit works everywhere', () => {
  registerUnit({ symbol: 'fur', dimension: 'length', factor: 201.168, names: { one: 'furlong', other: 'furlongs' }, aliases: ['furl'], decimals: 1 });
  assert.deepEqual(parse('8 furlongs'), { value: 8, unit: 'fur' });
  assert.deepEqual(parse('1 Furlong'), { value: 1, unit: 'fur' });
  assert.deepEqual(parse('3 furl'), { value: 3, unit: 'fur' });
  assert.deepEqual(parse('2fur'), { value: 2, unit: 'fur' });
  assert.equal(format({ value: 8, unit: 'fur' }), '8 furlongs');
  assert.equal(format({ value: 1, unit: 'fur' }), '1 furlong');
  assert.equal(format({ value: 1.26, unit: 'fur' }, { style: 'short' }), '1.3 fur');
  assert.ok(Math.abs(convert(8, 'fur', 'mi') - 1) < 1e-9);
  assert.equal(compare({ value: 5, unit: 'fur' }, { value: 1, unit: 'km' }), 1);
  assert.ok(Math.abs(sum([{ value: 1, unit: 'fur' }, { value: 1.168, unit: 'm' }], 'm').value - 202.336) < 1e-9);
  assert.equal(unitsOf('length').at(-1), 'fur');
});

test('hidden: a registered unit with an offset and its default decimals', () => {
  registerUnit({ symbol: 'Ra', dimension: 'temperature', factor: 5 / 9, names: { one: 'degree Rankine', other: 'degrees Rankine' }, aliases: ['°r', 'rankine'] });
  assert.ok(Math.abs(convert(491.67, 'Ra', 'C')) < 1e-9);
  assert.deepEqual(parse('10 °R'), { value: 10, unit: 'Ra' });
  assert.equal(format({ value: 1.234, unit: 'Ra' }), '1.23 degrees Rankine');
  registerUnit({ symbol: 'pinch', dimension: 'volume', factor: 0.0003, names: { one: 'pinch', other: 'pinches' } });
  assert.equal(format({ value: 2, unit: 'pinch' }), '2 pinches');
  assert.deepEqual(parse('2 pinches'), { value: 2, unit: 'pinch' });
});

test('hidden: taken symbols and aliases are refused, any case', () => {
  assert.throws(() => registerUnit({ symbol: 'KM', dimension: 'length', factor: 1, names: { one: 'x', other: 'xs' } }), UnitError);
  assert.throws(() => registerUnit({ symbol: 'zz1', dimension: 'length', factor: 1, names: { one: 'Mile', other: 'zz1s' } }), UnitError);
  assert.throws(() => registerUnit({ symbol: 'zz2', dimension: 'length', factor: 1, names: { one: 'zz2', other: 'zz2s' }, aliases: ['FEET'] }), UnitError);
  assert.throws(() => parse('1 zz1'), /Unknown unit/, 'a refused unit is not half-added');
});
