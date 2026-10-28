import { convert } from './convert.js';
import { nearlyEqual } from './numbers.js';

/** -1, 0 or 1; equal within 1e-9 (relative). */
export function compare(a, b) {
  const bv = convert(b.value, b.unit, a.unit);
  if (nearlyEqual(a.value, bv)) return 0;
  return a.value < bv ? -1 : 1;
}

export const equals = (a, b) => compare(a, b) === 0;

export function max(list) {
  return list.reduce((m, q) => (compare(q, m) > 0 ? q : m));
}

export function min(list) {
  return list.reduce((m, q) => (compare(q, m) < 0 ? q : m));
}
