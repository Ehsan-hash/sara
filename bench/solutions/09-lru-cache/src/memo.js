import { LRU } from './lru.js';

export function memoize(fn, capacity = 100) {
  const cache = new LRU(capacity);
  const memo = (arg) => {
    if (cache.has(arg)) return cache.get(arg);
    cache.stats.miss();
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
  memo.cache = cache;
  return memo;
}
