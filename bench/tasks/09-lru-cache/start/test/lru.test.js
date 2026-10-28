import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRU } from '../src/lru.js';

test('stores and reads', () => {
  const c = new LRU(2);
  c.set('a', 1).set('b', 2);
  assert.equal(c.get('a'), 1);
  assert.equal(c.size, 2);
});

test('evicts the least recently used', () => {
  const c = new LRU(2);
  c.set('a', 1).set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.has('a'), true);
  assert.equal(c.has('b'), false);
});
