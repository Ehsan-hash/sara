import { Stats } from './stats.js';

export class LRU {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
    this.stats = new Stats();
  }

  get(key) {
    if (this.map.has(key)) {
      this.stats.hit();
      return this.map.get(key);
    }
    this.stats.miss();
    return undefined;
  }

  set(key, value) {
    if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
      this.stats.evict();
    }
    this.map.set(key, value);
    return this;
  }

  has(key) {
    return this.map.has(key);
  }

  get size() {
    return this.map.size;
  }
}
