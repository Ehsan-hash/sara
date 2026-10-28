// The one place units live. Every unit, built-in or added with registerUnit(), has one entry:
// { symbol, dimension, factor, offset, names: { one, other }, aliases, decimals }, where
// base = value * factor + offset (bases: m, kg, l, K). parse, format, convert, compare, sum and
// unitsOf all read from here.
import { UnitError } from './errors.js';

const UNITS = new Map();
/** Every way of writing a unit (symbol, names, aliases), lower case → symbol. */
const WORDS = new Map();

const wordsOf = (def) => [def.symbol, def.names.one, def.names.other, ...(def.aliases ?? [])].map((w) => w.trim().replace(/\s+/g, ' ').toLowerCase());

export function registerUnit(def) {
  if (!def || typeof def.symbol !== 'string' || !def.symbol.trim()) throw new UnitError('A unit needs a symbol.');
  if (typeof def.dimension !== 'string' || !def.dimension) throw new UnitError(`Unit ${def.symbol} needs a dimension.`);
  if (!(typeof def.factor === 'number' && def.factor > 0 && Number.isFinite(def.factor))) throw new UnitError(`Unit ${def.symbol} needs a positive factor.`);
  if (!def.names || typeof def.names.one !== 'string' || typeof def.names.other !== 'string') throw new UnitError(`Unit ${def.symbol} needs names: { one, other }.`);
  const unit = {
    symbol: def.symbol,
    dimension: def.dimension,
    factor: def.factor,
    offset: def.offset ?? 0,
    names: { one: def.names.one, other: def.names.other },
    aliases: [...(def.aliases ?? [])],
    decimals: def.decimals ?? 2,
  };
  const words = [...new Set(wordsOf(unit))];
  // Check everything first so a refused unit is not half-added.
  if ([...UNITS.keys()].some((s) => s.toLowerCase() === unit.symbol.toLowerCase())) throw new UnitError(`Unit ${unit.symbol} already exists.`);
  for (const w of words) if (WORDS.has(w)) throw new UnitError(`"${w}" already means ${WORDS.get(w)}.`);
  UNITS.set(unit.symbol, unit);
  for (const w of words) WORDS.set(w, unit.symbol);
  return unit;
}

/** Extra spellings for an existing unit (parse only). */
export function addSpellings(symbol, spellings) {
  if (!UNITS.has(symbol)) throw new UnitError(`Unknown unit: ${symbol}`);
  for (const s of spellings) {
    const w = s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (WORDS.has(w) && WORDS.get(w) !== symbol) throw new UnitError(`"${w}" already means ${WORDS.get(w)}.`);
    WORDS.set(w, symbol);
  }
}

export function getUnit(symbol) {
  return UNITS.get(symbol);
}

export function unitFor(word) {
  return WORDS.get(word);
}

export function conversion(symbol) {
  const u = UNITS.get(symbol);
  if (!u) throw new UnitError(`Unknown unit: ${symbol}`);
  return { dimension: u.dimension, factor: u.factor, offset: u.offset };
}

export function hasConversion(symbol) {
  return UNITS.has(symbol);
}

export function unitsOf(dimension) {
  return [...UNITS.values()].filter((u) => u.dimension === dimension).map((u) => u.symbol);
}
