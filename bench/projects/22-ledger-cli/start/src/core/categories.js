// Category names: lower case, words joined by "-" ("Food & Drink" → "food-drink").
const ALIASES = { groceries: 'food', restaurant: 'food', restaurants: 'food', wage: 'income', salary: 'income', pay: 'income' };

export function normalizeCategory(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ALIASES[slug] ?? (slug || 'other');
}
