export class Emitter {
  #listeners = new Map();

  #add(event, entry) {
    const list = this.#listeners.get(event) ?? [];
    list.push(entry);
    this.#listeners.set(event, list);
    return () => {
      this.#remove(event, entry);
    };
  }

  #remove(event, entry) {
    const list = this.#listeners.get(event);
    const i = list ? list.indexOf(entry) : -1;
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  }

  on(event, fn) {
    return this.#add(event, { fn, original: fn });
  }

  once(event, fn) {
    const entry = {
      original: fn,
      fn: (...args) => {
        this.#remove(event, entry);
        return fn(...args);
      },
    };
    return this.#add(event, entry);
  }

  off(event, fn) {
    const entry = (this.#listeners.get(event) ?? []).find((e) => e.original === fn);
    return entry ? this.#remove(event, entry) : false;
  }

  emit(event, ...args) {
    const list = [...(this.#listeners.get(event) ?? [])];
    for (const entry of list) entry.fn(...args);
    return list.length;
  }

  listenerCount(event) {
    return this.#listeners.get(event)?.length ?? 0;
  }
}
