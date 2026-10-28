import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRU } from '../src/lru.js';
import { memoize } from '../src/memo.js';

test('get refreshes recency', () => {
  const c = new LRU(2);
  c.set('a', 1).set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.deepEqual([c.has('a'), c.has('b'), c.has('c')], [true, false, true]);
  assert.equal(c.stats.snapshot().evictions, 1);
});
test('set refreshes recency and updating never evicts', () => {
  const c = new LRU(2);
  c.set('a', 1).set('b', 2).set('a', 10);
  assert.equal(c.size, 2);
  assert.equal(c.stats.snapshot().evictions, 0);
  assert.equal(c.has('b'), true);
  c.set('c', 3);
  assert.deepEqual([c.has('a'), c.has('b'), c.has('c')], [true, false, true]);
  assert.equal(c.get('a'), 10);
});
test('has does not change order or stats', () => {
  const c = new LRU(2);
  c.set('a', 1).set('b', 2);
  c.has('a');
  c.set('c', 3);
  assert.equal(c.has('a'), false);
  assert.deepEqual(c.stats.snapshot(), { hits: 0, misses: 0, evictions: 1, hitRate: 0 });
});
test('capacity 0 stores nothing', () => {
  const c = new LRU(0);
  c.set('a', 1);
  assert.equal(c.size, 0);
  assert.equal(c.get('a'), undefined);
});
test('hit rate', () => {
  const c = new LRU(3);
  assert.equal(c.stats.snapshot().hitRate, 0);
  c.set('a', 1);
  c.get('a');
  c.get('a');
  c.get('a');
  c.get('x');
  assert.deepEqual(c.stats.snapshot(), { hits: 3, misses: 1, evictions: 0, hitRate: 0.75 });
});
test('memoize caches undefined and counts one lookup per call', () => {
  let calls = 0;
  const m = memoize((x) => {
    calls++;
    return x > 0 ? x * 2 : undefined;
  });
  assert.equal(m(-1), undefined);
  assert.equal(m(-1), undefined);
  assert.equal(m(4), 8);
  assert.equal(m(4), 8);
  assert.equal(calls, 2);
  assert.deepEqual(m.cache.stats.snapshot(), { hits: 2, misses: 2, evictions: 0, hitRate: 0.5 });
});
test('memoize respects capacity', () => {
  let calls = 0;
  const m = memoize((x) => {
    calls++;
    return x;
  }, 1);
  m(1);
  m(2);
  m(1);
  assert.equal(calls, 3);
});
