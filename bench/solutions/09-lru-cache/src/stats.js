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
    const lookups = this.hits + this.misses;
    return lookups ? this.hits / lookups : 0;
  }

  snapshot() {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, hitRate: this.hitRate };
  }
}
