// An in-memory store with a few collections. Records are copied in and out so callers can't
// change stored data by accident.
import { idMaker } from '../util/ids.js';

const copy = (x) => (x === undefined ? undefined : structuredClone(x));

export class Collection {
  constructor(prefix) {
    this.rows = new Map();
    this.nextId = idMaker(prefix);
  }
  insert(data) {
    const row = { id: this.nextId(), ...copy(data) };
    this.rows.set(row.id, row);
    return copy(row);
  }
  get(id) {
    return copy(this.rows.get(id));
  }
  update(id, patch) {
    const row = this.rows.get(id);
    if (!row) return undefined;
    Object.assign(row, copy(patch), { id });
    return copy(row);
  }
  remove(id) {
    return this.rows.delete(id);
  }
  find(pred = () => true) {
    return [...this.rows.values()].filter(pred).map(copy);
  }
  removeWhere(pred) {
    let n = 0;
    for (const [id, row] of this.rows) if (pred(row)) n += this.rows.delete(id) ? 1 : 0;
    return n;
  }
}

export function createStore() {
  return { users: new Collection('u'), notes: new Collection('n'), shares: new Collection('s') };
}
