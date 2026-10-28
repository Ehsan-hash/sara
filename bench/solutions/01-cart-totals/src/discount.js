import { roundCents } from './money.js';

/** How many cents a discount takes off a subtotal (never more than the subtotal). */
export function discountAmount(subtotal, discount) {
  if (!discount) return 0;
  if (discount.type === 'percent') return Math.min(subtotal, roundCents((subtotal * discount.value) / 100));
  if (discount.type === 'fixed') return Math.min(subtotal, discount.value);
  throw new Error(`Unknown discount type: ${discount.type}`);
}
