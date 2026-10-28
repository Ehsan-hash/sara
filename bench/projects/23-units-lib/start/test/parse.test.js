import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse, parseAll } from '../src/index.js';

test('symbols, names, aliases, any case, with or without a space', () => {
  assert.deepEqual(parse('5 ft'), { value: 5, unit: 'ft' });
  assert.deepEqual(parse('5ft'), { value: 5, unit: 'ft' });
  assert.deepEqual(parse('5 Feet'), { value: 5, unit: 'ft' });
  assert.deepEqual(parse('2.5 KILOS'), { value: 2.5, unit: 'kg' });
  assert.deepEqual(parse('350 millilitres'), { value: 350, unit: 'ml' });
  assert.deepEqual(parse('2 fl oz'), { value: 2, unit: 'floz' });
  assert.deepEqual(parse('20 °C'), { value: 20, unit: 'C' });
  assert.deepEqual(parse('6\''), { value: 6, unit: 'ft' });
});

test('numbers people write', () => {
  assert.equal(parse('1,250 m').value, 1250);
  assert.equal(parse('1/2 tsp').value, 0.5);
  assert.equal(parse('1 1/2 tsp').value, 1.5);
  assert.equal(parse('½ tsp').value, 0.5);
  assert.equal(parse('2½ tbsp').value, 2.5);
  assert.equal(parse('-40 F').value, -40);
});

test('errors', () => {
  assert.throws(() => parse('ft'), /No number/);
  assert.throws(() => parse('5'), /No unit/);
  assert.throws(() => parse('5 parsecs'), /Unknown unit/);
});

test('several quantities', () => {
  assert.deepEqual(parseAll('5 ft 3 in'), [{ value: 5, unit: 'ft' }, { value: 3, unit: 'in' }]);
  assert.deepEqual(parseAll('1 kg 200 g'), [{ value: 1, unit: 'kg' }, { value: 200, unit: 'g' }]);
});
