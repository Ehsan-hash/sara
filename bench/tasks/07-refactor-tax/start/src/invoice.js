const TAX = { CA: 0.0725, NY: 0.04, TX: 0.0625, OR: 0 };

/** One invoice line per order line; tax is worked out (and rounded) per line. */
export function invoiceLines(order) {
  const rate = TAX[String(order.region).toUpperCase()];
  if (rate === undefined) throw new Error(`Unknown region: ${order.region}`);
  return order.lines.map((l) => {
    const amount = l.priceCents * l.qty;
    return { sku: l.sku, amount, tax: Math.round(amount * rate) };
  });
}

export function invoiceText(order) {
  const money = (c) => (c / 100).toFixed(2);
  return invoiceLines(order)
    .map((l) => `${l.sku}\t${money(l.amount)}\t${money(l.tax)}`)
    .join('\n');
}
