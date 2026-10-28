export class Emitter {
  #listeners = new Map();

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(fn);
  }

  emit(event, ...args) {
    const list = this.#listeners.get(event) ?? [];
    for (const fn of list) fn(...args);
    return list.length;
  }
}
