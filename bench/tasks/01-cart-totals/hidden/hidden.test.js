import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal, subtotal } from '../src/cart.js';
import { discountAmount } from '../src/discount.js';
import { roundCents, formatCents } from '../src/money.js';

test('subtotal counts quantities', () => {
  assert.equal(subtotal([{ priceCents: 250, qty: 3 }, { priceCents: 99, qty: 1 }]), 849);
});
test('rounding is half up', () => {
  assert.equal(roundCents(10.5), 11);
  assert.equal(roundCents(10.49), 10);
  assert.equal(roundCents(7), 7);
});
test('percent discount rounds', () => {
  assert.equal(discountAmount(999, { type: 'percent', value: 15 }), 150);
});
test('fixed discount never exceeds the subtotal', () => {
  assert.equal(discountAmount(300, { type: 'fixed', value: 500 }), 300);
  assert.equal(discountAmount(3000, { type: 'fixed', value: 500 }), 500);
});
test('no discount', () => {
  assert.equal(discountAmount(1000, undefined), 0);
});
test('tax is on the discounted subtotal', () => {
  assert.deepEqual(cartTotal([{ priceCents: 1000, qty: 2 }, { priceCents: 350, qty: 1 }], { discount: { type: 'percent', value: 10 }, taxRate: 0.08 }), { subtotal: 2350, discount: 235, tax: 169, total: 2284 });
});
test('a fixed discount bigger than the cart', () => {
  assert.deepEqual(cartTotal([{ priceCents: 300, qty: 1 }], { discount: { type: 'fixed', value: 500 }, taxRate: 0.1 }), { subtotal: 300, discount: 300, tax: 0, total: 0 });
});
test('formatting still works', () => {
  assert.equal(formatCents(5), '$0.05');
});
