// Length units (base: metre). docs/UNITS.md
import { registerUnit } from '../registry.js';

for (const [symbol, factor, one, other, aliases, decimals, offset] of [
  ['m', 1, 'metre', 'metres', ['meter', 'meters'], 2],
  ['km', 1000, 'kilometre', 'kilometres', ['kilometer', 'kilometers'], 3],
  ['cm', 0.01, 'centimetre', 'centimetres', ['centimeter', 'centimeters'], 1],
  ['mm', 0.001, 'millimetre', 'millimetres', ['millimeter', 'millimeters'], 0],
  ['mi', 1609.344, 'mile', 'miles', [], 2],
  ['yd', 0.9144, 'yard', 'yards', [], 2],
  ['ft', 0.3048, 'foot', 'feet', ["'"], 2],
  ['in', 0.0254, 'inch', 'inches', ['"'], 2],
  ['nmi', 1852, 'nautical mile', 'nautical miles', [], 2],
]) registerUnit({ symbol, dimension: 'length', factor, offset, names: { one, other }, aliases, decimals });
