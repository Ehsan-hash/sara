import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';
import { formatCents } from '../src/money.js';

test('formats cents', () => {
  assert.equal(formatCents(1234), '$12.34');
});

test('two of an item, a percent discount and tax', () => {
  const t = cartTotal([{ priceCents: 500, qty: 2 }], { discount: { type: 'percent', value: 10 }, taxRate: 0.1 });
  assert.deepEqual(t, { subtotal: 1000, discount: 100, tax: 90, total: 990 });
});
