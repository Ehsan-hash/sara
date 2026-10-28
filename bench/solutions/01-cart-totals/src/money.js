/** Rounds an amount of cents to a whole cent, half up. */
export function roundCents(x) {
  return Math.round(x);
}

/** 1234 -> "$12.34" */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
