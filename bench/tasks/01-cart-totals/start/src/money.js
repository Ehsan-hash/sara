/** Rounds an amount of cents to a whole cent. */
export function roundCents(x) {
  return Math.floor(x);
}

/** 1234 -> "$12.34" */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
