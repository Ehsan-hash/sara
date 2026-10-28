// Temperature units (base: kelvin). docs/UNITS.md
import { registerUnit } from '../registry.js';

for (const [symbol, factor, one, other, aliases, decimals, offset] of [
  ['K', 1, 'kelvin', 'kelvins', [], 1, 0],
  ['C', 1, 'degree Celsius', 'degrees Celsius', ['°c', 'celsius'], 1, 273.15],
  ['F', 5 / 9, 'degree Fahrenheit', 'degrees Fahrenheit', ['°f', 'fahrenheit'], 1, (459.67 * 5) / 9],
]) registerUnit({ symbol, dimension: 'temperature', factor, offset, names: { one, other }, aliases, decimals });
