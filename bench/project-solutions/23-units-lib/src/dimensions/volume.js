// Volume units (base: litre). docs/UNITS.md
import { registerUnit } from '../registry.js';

for (const [symbol, factor, one, other, aliases, decimals, offset] of [
  ['l', 1, 'litre', 'litres', ['liter', 'liters'], 2],
  ['ml', 0.001, 'millilitre', 'millilitres', ['milliliter', 'milliliters'], 0],
  ['gal', 3.785411784, 'gallon', 'gallons', [], 2],
  ['qt', 0.946352946, 'quart', 'quarts', [], 2],
  ['pt', 0.473176473, 'pint', 'pints', [], 2],
  ['floz', 0.0295735295625, 'fluid ounce', 'fluid ounces', ['fl oz'], 2],
  ['tbsp', 0.01478676478125, 'tablespoon', 'tablespoons', [], 1],
  ['tsp', 0.00492892159375, 'teaspoon', 'teaspoons', [], 1],
  ['cup', 0.2365882365, 'cup', 'cups', [], 2],
]) registerUnit({ symbol, dimension: 'volume', factor, offset, names: { one, other }, aliases, decimals });
