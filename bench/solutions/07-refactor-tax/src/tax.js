/** Sales tax by US state (regions may be written in any case). */
const RATES = { CA: 0.0725, NY: 0.04, TX: 0.0625, OR: 0 };

export function taxRate(region) {
  const rate = RATES[String(region).toUpperCase()];
  if (rate === undefined) throw new Error(`Unknown region: ${region}`);
  return rate;
}

/** Tax on an amount of cents, rounded to a whole cent. */
export function computeTax(amountCents, region) {
  return Math.round(amountCents * taxRate(region));
}
