import { computeTax, taxRate } from './tax.js';

/** One invoice line per order line; tax is worked out (and rounded) per line. */
export function invoiceLines(order) {
  taxRate(order.region); // throws for an unknown region, even with no lines
  return order.lines.map((l) => {
    const amount = l.priceCents * l.qty;
    return { sku: l.sku, amount, tax: computeTax(amount, order.region) };
  });
}

export function invoiceText(order) {
  const money = (c) => (c / 100).toFixed(2);
  return invoiceLines(order)
    .map((l) => `${l.sku}\t${money(l.amount)}\t${money(l.tax)}`)
    .join('\n');
}
