import { Stats } from './stats.js';

export class LRU {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
    this.stats = new Stats();
  }

  get(key) {
    if (!this.map.has(key)) {
      this.stats.miss();
      return undefined;
    }
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    this.stats.hit();
    return value;
  }

  set(key, value) {
    if (this.capacity <= 0) return this;
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      this.map.delete(this.map.keys().next().value);
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
