// Volume units: names, aliases and decimals (factors are in src/registry.js).
export const VOLUME = {
  l: { one: 'litre', other: 'litres', aliases: ['liter', 'liters'], decimals: 2 },
  ml: { one: 'millilitre', other: 'millilitres', aliases: ['milliliter', 'milliliters'], decimals: 0 },
  gal: { one: 'gallon', other: 'gallons', aliases: [], decimals: 2 },
  qt: { one: 'quart', other: 'quarts', aliases: [], decimals: 2 },
  pt: { one: 'pint', other: 'pints', aliases: [], decimals: 2 },
  floz: { one: 'fluid ounce', other: 'fluid ounces', aliases: ['fl oz'], decimals: 2 },
  tbsp: { one: 'tablespoon', other: 'tablespoons', aliases: [], decimals: 1 },
  tsp: { one: 'teaspoon', other: 'teaspoons', aliases: [], decimals: 1 },
};
