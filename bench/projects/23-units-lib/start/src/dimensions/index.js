import { LENGTH } from './length.js';
import { MASS } from './mass.js';
import { TEMPERATURE } from './temperature.js';
import { VOLUME } from './volume.js';

export const DIMENSIONS = { length: LENGTH, mass: MASS, volume: VOLUME, temperature: TEMPERATURE };

/** The naming data of a unit: { symbol, dimension, one, other, aliases, decimals } or undefined. */
export function naming(symbol) {
  for (const [dimension, units] of Object.entries(DIMENSIONS)) if (units[symbol]) return { symbol, dimension, ...units[symbol] };
  return undefined;
}

export function unitsOf(dimension) {
  return Object.keys(DIMENSIONS[dimension] ?? {});
}
