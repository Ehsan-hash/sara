// Mass units (base: kilogram). docs/UNITS.md
import { registerUnit } from '../registry.js';

for (const [symbol, factor, one, other, aliases, decimals, offset] of [
  ['kg', 1, 'kilogram', 'kilograms', ['kilo', 'kilos'], 3],
  ['g', 0.001, 'gram', 'grams', ['gr'], 1],
  ['mg', 0.000001, 'milligram', 'milligrams', [], 0],
  ['t', 1000, 'tonne', 'tonnes', ['ton', 'tons'], 3],
  ['lb', 0.45359237, 'pound', 'pounds', ['lbs'], 2],
  ['oz', 0.028349523125, 'ounce', 'ounces', [], 2],
  ['st', 6.35029318, 'stone', 'stone', ['stones'], 2],
]) registerUnit({ symbol, dimension: 'mass', factor, offset, names: { one, other }, aliases, decimals });
