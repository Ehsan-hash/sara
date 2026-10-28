# cart

Works out the totals of a shopping cart. All amounts are whole **cents** (integers).

- An item is `{ priceCents, qty }`. The subtotal is the sum of `priceCents * qty`.
- A discount is optional: `{ type: 'percent', value: 10 }` (10 % of the subtotal) or
  `{ type: 'fixed', value: 500 }` (5.00 off). A discount is never more than the subtotal.
- Tax is charged on the subtotal **after** the discount: `tax = round(discounted * taxRate)`.
- Rounding to whole cents is always "half up": 10.5 becomes 11, 10.49 becomes 10.
- `cartTotal(items, { discount, taxRate })` returns `{ subtotal, discount, tax, total }`, where
  `total = subtotal - discount + tax`.

Run the tests with `npm test` (or `node --test`).
