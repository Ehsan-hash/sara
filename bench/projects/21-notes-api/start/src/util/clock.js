// Time in one place, so tests can move it.

export function systemClock() {
  return { now: () => Date.now() };
}

/** A clock that only moves when told to (tests). */
export function fixedClock(start = Date.parse('2026-03-02T09:00:00Z')) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    set(ms) {
      t = ms;
    },
  };
}

/** Whole seconds since the epoch. */
export function nowSeconds(clock) {
  return Math.floor(clock.now() / 1000);
}

export function iso(clock) {
  return new Date(clock.now()).toISOString();
}
