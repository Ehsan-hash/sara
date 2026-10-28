// The ledger: entries in memory, kept sorted by date then id.
import { compareDates } from './dates.js';

export class Ledger {
  constructor(data = { nextId: 1, entries: [] }) {
    this.nextId = data.nextId ?? 1;
    this.entries = [...(data.entries ?? [])];
  }

  add({ date, description, amount, category, tags = [] }) {
    const entry = { id: this.nextId++, date, description, amount, category, tags: [...new Set(tags)] };
    this.entries.push(entry);
    this.entries.sort((a, b) => compareDates(a.date, b.date) || a.id - b.id);
    return entry;
  }

  remove(id) {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return false;
    this.entries.splice(i, 1);
    return true;
  }

  list(filter = () => true) {
    return this.entries.filter(filter).map((e) => ({ ...e, tags: [...e.tags] }));
  }

  toJSON() {
    return { nextId: this.nextId, entries: this.entries };
  }
}
