import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderTotal } from '../src/orders.js';
import { invoiceText } from '../src/invoice.js';

const order = { region: 'ny', lines: [{ sku: 'A', priceCents: 1000, qty: 2 }, { sku: 'B', priceCents: 250, qty: 1 }] };

test('order total', () => {
  assert.deepEqual(orderTotal(order), { subtotal: 2250, tax: 90, total: 2340 });
});

test('invoice text', () => {
  assert.equal(invoiceText(order), 'A\t20.00\t0.80\nB\t2.50\t0.10');
});
