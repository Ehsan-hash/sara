export class Stats {
  hits = 0;
  misses = 0;
  evictions = 0;

  hit() {
    this.hits++;
  }

  miss() {
    this.misses++;
  }

  evict() {
    this.evictions++;
  }

  get hitRate() {
    return this.hits / (this.misses || 1);
  }

  snapshot() {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, hitRate: this.hitRate };
  }
}
