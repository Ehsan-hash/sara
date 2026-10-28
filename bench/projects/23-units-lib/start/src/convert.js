import { UnitError } from './errors.js';
import { conversion } from './registry.js';

export function toBase(value, unit) {
  const c = conversion(unit);
  return { value: value * c.factor + c.offset, dimension: c.dimension };
}

export function convert(value, from, to) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UnitError('convert() needs a finite number.');
  const a = conversion(from);
  const b = conversion(to);
  if (a.dimension !== b.dimension) throw new UnitError(`Cannot convert ${a.dimension} (${from}) to ${b.dimension} (${to}).`);
  if (from === to) return value;
  return (value * a.factor + a.offset - b.offset) / b.factor;
}

export function convertQuantity(q, to) {
  return { value: convert(q.value, q.unit, to), unit: to };
}
