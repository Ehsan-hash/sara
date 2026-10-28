import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('simple rows', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('a quoted comma', () => {
  assert.deepEqual(parseCsv('name,city\n"Smith, J",Oslo'), [['name', 'city'], ['Smith, J', 'Oslo']]);
});
