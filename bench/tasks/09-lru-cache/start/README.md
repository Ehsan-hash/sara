# lru

A least-recently-used cache with statistics, and a `memoize` helper built on it.

- `new LRU(capacity)`. When a new key would make it hold more than `capacity` entries, the
  **least recently used** entry is evicted first. Capacity `0` stores nothing.
- `get(key)` returns the value (or `undefined`), counts one hit or one miss, and makes the key the
  most recently used.
- `set(key, value)` stores a value and makes the key the most recently used. Updating a key that
  is already there never evicts anything. Returns the cache.
- `has(key)` and `size` don't count as use: no stats, no change of order.
- `cache.stats.snapshot()` gives `{ hits, misses, evictions, hitRate }`, where
  `hitRate = hits / (hits + misses)`, or `0` before any lookup.
- `memoize(fn, capacity)` returns a function of one argument that caches `fn`'s results per
  argument, including results that are `undefined`. Each call counts exactly one hit or one miss
  in `memo.cache.stats`.

Run the tests with `npm test`.
