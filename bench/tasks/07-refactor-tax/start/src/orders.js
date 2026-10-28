const RATES = { CA: 0.0725, NY: 0.04, TX: 0.0625, OR: 0 };

/** Subtotal, tax (on the whole subtotal) and total of an order, in cents. */
export function orderTotal(order) {
  const subtotal = order.lines.reduce((n, l) => n + l.priceCents * l.qty, 0);
  const rate = RATES[order.region.toUpperCase()];
  if (rate === undefined) throw new Error(`Unknown region: ${order.region}`);
  const tax = Math.round(subtotal * rate);
  return { subtotal, tax, total: subtotal + tax };
}

export function isTaxFree(order) {
  return RATES[order.region.toUpperCase()] === 0;
}
