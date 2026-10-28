import { roundCents } from './money.js';
import { discountAmount } from './discount.js';

export function subtotal(items) {
  return items.reduce((n, item) => n + item.priceCents, 0);
}

export function cartTotal(items, opts = {}) {
  const sub = subtotal(items);
  const discount = discountAmount(sub, opts.discount);
  const tax = roundCents(sub * (opts.taxRate ?? 0));
  return { subtotal: sub, discount, tax, total: sub - discount + tax };
}
