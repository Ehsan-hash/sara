import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, convert, format, parse, sum, unitsOf } from '../src/index.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${msg ?? ''} ${a} vs ${b}`);

test('hidden: the three new units everywhere', () => {
  assert.deepEqual(parse('2 Nautical Miles'), { value: 2, unit: 'nmi' });
  assert.deepEqual(parse('1 nautical mile'), { value: 1, unit: 'nmi' });
  assert.equal(format({ value: 1, unit: 'nmi' }), '1 nautical mile');
  assert.equal(format({ value: 2.346, unit: 'nmi' }, { style: 'short' }), '2.35 nmi');
  close(convert(10, 'km', 'nmi'), 10000 / 1852);
  assert.deepEqual(parse('2 stones'), { value: 2, unit: 'st' });
  assert.deepEqual(parse('2 st'), { value: 2, unit: 'st' });
  assert.equal(format({ value: 1, unit: 'st' }), '1 stone');
  assert.equal(format({ value: 1.5, unit: 'st' }), '1.5 stone');
  close(convert(1, 'st', 'kg'), 6.35029318);
  assert.deepEqual(parse('½ cup'), { value: 0.5, unit: 'cup' });
  assert.equal(format({ value: 1, unit: 'cup' }), '1 cup');
  assert.equal(format({ value: 3, unit: 'cup' }), '3 cups');
  close(convert(1, 'cup', 'tbsp'), 16);
  assert.equal(compare({ value: 1, unit: 'nmi' }, { value: 1, unit: 'mi' }), 1);
  close(sum([{ value: 1, unit: 'cup' }, { value: 1, unit: 'cup' }], 'pt').value, 1);
  assert.ok(unitsOf('length').includes('nmi') && unitsOf('mass').includes('st') && unitsOf('volume').includes('cup'));
});

test('hidden: built-in units are unchanged', () => {
  assert.equal(format({ value: 1250.456, unit: 'm' }), '1,250.46 metres');
  assert.equal(format({ value: 1, unit: 'F' }), '1 degree Fahrenheit');
  assert.equal(format({ value: 3, unit: 'floz' }, { style: 'short' }), '3 floz');
  assert.deepEqual(parse('2 fl. oz'), { value: 2, unit: 'floz' });
  assert.deepEqual(parse('3 lbs'), { value: 3, unit: 'lb' });
  assert.deepEqual(parse('5 \''), { value: 5, unit: 'ft' });
  close(convert(212, 'F', 'K'), 373.15);
  assert.deepEqual(unitsOf('mass').slice(0, 6), ['kg', 'g', 'mg', 't', 'lb', 'oz']);
  assert.deepEqual(unitsOf('temperature'), ['K', 'C', 'F']);
});
