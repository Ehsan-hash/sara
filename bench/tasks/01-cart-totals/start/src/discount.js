import { roundCents } from './money.js';

/** How many cents a discount takes off a subtotal. */
export function discountAmount(subtotal, discount) {
  if (!discount) return 0;
  if (discount.type === 'percent') return roundCents((subtotal * discount.value) / 100);
  if (discount.type === 'fixed') return discount.value;
  throw new Error(`Unknown discount type: ${discount.type}`);
}
