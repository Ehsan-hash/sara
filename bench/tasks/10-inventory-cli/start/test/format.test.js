import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table } from '../src/format.js';

test('table', () => {
  assert.equal(table([{ sku: 'A', name: 'Bolt', qty: 5 }]), 'NAME  QTY\nBolt    5');
});
