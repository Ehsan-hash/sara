import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toObjects } from '../src/csv.js';

test('trailing newline adds no row', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});
test('quotes, commas and doubled quotes', () => {
  assert.deepEqual(parseCsv('name,note\n"Smith, J","said ""hi"""\n'), [['name', 'note'], ['Smith, J', 'said "hi"']]);
});
test('line breaks inside quotes and CRLF rows', () => {
  assert.deepEqual(parseCsv('a,b\r\n"line1\nline2",x\r\n'), [['a', 'b'], ['line1\nline2', 'x']]);
});
test('empty fields are kept', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv('x,\ny,z'), [['x', ''], ['y', 'z']]);
});
test('empty text', () => {
  assert.deepEqual(parseCsv(''), []);
});
test('toObjects', () => {
  assert.deepEqual(toObjects('id,name\n1,"Lee, A"\n2,Bo'), [{ id: '1', name: 'Lee, A' }, { id: '2', name: 'Bo' }]);
  assert.deepEqual(toObjects('id,name\n3'), [{ id: '3', name: '' }]);
});
