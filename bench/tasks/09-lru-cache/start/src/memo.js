import { LRU } from './lru.js';

export function memoize(fn, capacity = 100) {
  const cache = new LRU(capacity);
  const memo = (arg) => {
    const cached = cache.get(arg);
    if (cached !== undefined) return cached;
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
  memo.cache = cache;
  return memo;
}
