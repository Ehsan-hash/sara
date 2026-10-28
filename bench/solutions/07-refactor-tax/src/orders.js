import { computeTax, taxRate } from './tax.js';

/** Subtotal, tax (on the whole subtotal) and total of an order, in cents. */
export function orderTotal(order) {
  const subtotal = order.lines.reduce((n, l) => n + l.priceCents * l.qty, 0);
  const tax = computeTax(subtotal, order.region);
  return { subtotal, tax, total: subtotal + tax };
}

export function isTaxFree(order) {
  return taxRate(order.region) === 0;
}
