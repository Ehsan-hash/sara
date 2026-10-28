import { UnitError } from './errors.js';
import { convert } from './convert.js';
import { conversion } from './registry.js';

/** Adds quantities of one dimension; the result is in `unit` (default: the first one's). */
export function sum(list, unit = list?.[0]?.unit) {
  if (!Array.isArray(list) || !list.length) throw new UnitError('sum() needs at least one quantity.');
  if (conversion(unit).dimension === 'temperature') throw new UnitError('Temperatures cannot be added.');
  return { value: list.reduce((n, q) => n + convert(q.value, q.unit, unit), 0), unit };
}
