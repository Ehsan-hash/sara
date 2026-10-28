// Conversion data: each unit's dimension and how to get to the dimension's base unit
// (base = value * factor + offset). Used by convert().
import { UnitError } from './errors.js';

const UNITS = new Map([
  ['m', { dimension: 'length', factor: 1 }],
  ['km', { dimension: 'length', factor: 1000 }],
  ['cm', { dimension: 'length', factor: 0.01 }],
  ['mm', { dimension: 'length', factor: 0.001 }],
  ['mi', { dimension: 'length', factor: 1609.344 }],
  ['yd', { dimension: 'length', factor: 0.9144 }],
  ['ft', { dimension: 'length', factor: 0.3048 }],
  ['in', { dimension: 'length', factor: 0.0254 }],
  ['kg', { dimension: 'mass', factor: 1 }],
  ['g', { dimension: 'mass', factor: 0.001 }],
  ['mg', { dimension: 'mass', factor: 0.000001 }],
  ['t', { dimension: 'mass', factor: 1000 }],
  ['lb', { dimension: 'mass', factor: 0.45359237 }],
  ['oz', { dimension: 'mass', factor: 0.028349523125 }],
  ['l', { dimension: 'volume', factor: 1 }],
  ['ml', { dimension: 'volume', factor: 0.001 }],
  ['gal', { dimension: 'volume', factor: 3.785411784 }],
  ['qt', { dimension: 'volume', factor: 0.946352946 }],
  ['pt', { dimension: 'volume', factor: 0.473176473 }],
  ['floz', { dimension: 'volume', factor: 0.0295735295625 }],
  ['tbsp', { dimension: 'volume', factor: 0.01478676478125 }],
  ['tsp', { dimension: 'volume', factor: 0.00492892159375 }],
  ['K', { dimension: 'temperature', factor: 1, offset: 0 }],
  ['C', { dimension: 'temperature', factor: 1, offset: 273.15 }],
  ['F', { dimension: 'temperature', factor: 5 / 9, offset: (459.67 * 5) / 9 }],
]);

export function conversion(symbol) {
  const u = UNITS.get(symbol);
  if (!u) throw new UnitError(`Unknown unit: ${symbol}`);
  return { dimension: u.dimension, factor: u.factor, offset: u.offset ?? 0 };
}

export function hasConversion(symbol) {
  return UNITS.has(symbol);
}

/**
 * Adds a unit (see README). TODO: parse and format still read their own tables in
 * src/dimensions/, so a registered unit can be converted but not parsed or printed by name.
 */
export function registerUnit(def) {
  if (!def || typeof def.symbol !== 'string' || !def.symbol) throw new UnitError('A unit needs a symbol.');
  if (UNITS.has(def.symbol)) throw new UnitError(`Unit ${def.symbol} already exists.`);
  if (!(def.factor > 0)) throw new UnitError('A unit needs a positive factor.');
  UNITS.set(def.symbol, { dimension: def.dimension, factor: def.factor, offset: def.offset ?? 0 });
}
