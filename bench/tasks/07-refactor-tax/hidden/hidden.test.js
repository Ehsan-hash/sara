import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderTotal, isTaxFree } from '../src/orders.js';
import { invoiceLines, invoiceText } from '../src/invoice.js';
import * as tax from '../src/tax.js';

const order = { region: 'Ca', lines: [{ sku: 'A', priceCents: 1999, qty: 3 }, { sku: 'B', priceCents: 15, qty: 7 }, { sku: 'C', priceCents: 1000, qty: 1 }] };

test('tax.js exports taxRate and computeTax', () => {
  assert.equal(typeof tax.taxRate, 'function');
  assert.equal(typeof tax.computeTax, 'function');
  assert.equal(tax.taxRate('CA'), 0.0725);
  assert.equal(tax.taxRate('tx'), 0.0625);
  assert.equal(tax.computeTax(1000, 'ca'), Math.round(1000 * 0.0725));
  assert.equal(tax.computeTax(5997, 'NY'), 240);
  assert.equal(tax.computeTax(500, 'OR'), 0);
});
test('order totals did not change', () => {
  assert.deepEqual(orderTotal(order), { subtotal: 7102, tax: 515, total: 7617 });
  assert.deepEqual(orderTotal({ ...order, region: 'tx' }), { subtotal: 7102, tax: 444, total: 7546 });
  assert.throws(() => orderTotal({ ...order, region: 'zz' }), /Unknown region: zz/);
  assert.equal(isTaxFree({ region: 'or' }), true);
  assert.equal(isTaxFree({ region: 'CA' }), false);
});
test('invoices did not change (tax per line)', () => {
  assert.deepEqual(invoiceLines(order), [{ sku: 'A', amount: 5997, tax: 435 }, { sku: 'B', amount: 105, tax: 8 }, { sku: 'C', amount: 1000, tax: 73 }]);
  assert.equal(invoiceText(order), 'A\t59.97\t4.35\nB\t1.05\t0.08\nC\t10.00\t0.73');
  assert.throws(() => invoiceLines({ ...order, region: 'xx' }), /Unknown region: xx/);
});
test('the rate table lives only in tax.js', () => {
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  for (const f of ['orders.js', 'invoice.js']) {
    assert.ok(!src(f).includes('0.0725'), `${f} still has the rate table`);
    assert.match(src(f), /from\s+['"]\.\/tax\.js['"]/, `${f} does not import ./tax.js`);
  }
  assert.ok(src('tax.js').includes('0.0725'));
});
