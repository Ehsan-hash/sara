/** Cents to text: "-1,234.50" (grouping: false → "-1234.50"). */
export function formatAmount(cents, { grouping = true } = {}) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole}.${frac}`;
}
