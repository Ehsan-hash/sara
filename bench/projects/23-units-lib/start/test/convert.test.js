import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, convert, max, sum, unitsOf } from '../src/index.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('lengths, masses, volumes', () => {
  close(convert(1, 'mi', 'km'), 1.609344);
  close(convert(12, 'in', 'ft'), 1);
  close(convert(1, 'lb', 'oz'), 16);
  close(convert(1, 'gal', 'qt'), 4);
  close(convert(3, 'tsp', 'tbsp'), 1);
  close(convert(1, 't', 'kg'), 1000);
});

test('temperatures', () => {
  close(convert(100, 'C', 'F'), 212);
  close(convert(-40, 'F', 'C'), -40);
  close(convert(0, 'K', 'C'), -273.15);
});

test('dimensions must match', () => {
  assert.throws(() => convert(1, 'kg', 'm'), /Cannot convert mass/);
  assert.throws(() => convert(1, 'kg', 'zz'), /Unknown unit/);
});

test('compare and sum', () => {
  assert.equal(compare({ value: 1, unit: 'kg' }, { value: 900, unit: 'g' }), 1);
  assert.equal(compare({ value: 1000, unit: 'ml' }, { value: 1, unit: 'l' }), 0);
  assert.deepEqual(max([{ value: 1, unit: 'ft' }, { value: 13, unit: 'in' }]), { value: 13, unit: 'in' });
  const s = sum([{ value: 1, unit: 'm' }, { value: 50, unit: 'cm' }]);
  close(s.value, 1.5);
  assert.throws(() => sum([{ value: 1, unit: 'C' }]), /Temperatures/);
});

test('units of a dimension', () => {
  assert.deepEqual(unitsOf('mass').slice(0, 6), ['kg', 'g', 'mg', 't', 'lb', 'oz']);
});
