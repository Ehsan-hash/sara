# ledger

A bank-account ledger read from lines like `2026-01-05, deposit, 100.10`.

- Money is exact: every amount, change and balance is a `decimal.Decimal` (never a float).
- `parse_line(line)` returns `(date, kind, amount)`, with the amount as a `Decimal`. Blank lines
  and lines starting with `#` give `None`. Kinds are lowercased.
- `Book().load(text)` applies every line in order and returns the book. `book.balance` is the
  balance; `book.history` is a list of `(date, kind, change, balance_after)`.
- Kinds:
  - `deposit` adds the amount;
  - `withdraw` takes the amount off, but if that would make the balance negative it raises
    `InsufficientFunds` and changes nothing;
  - `fee` takes the amount off and **may** make the balance negative;
  - `interest`: the amount is a percentage; the change is `balance * amount / 100`, rounded to
    the cent with **half up** rounding (2.675 becomes 2.68);
  - anything else raises `ValueError`.
- `money(x)` formats an amount with a thousands separator and 2 decimals: `1,234.50`, `-2.50`.

Run the tests with `python -m unittest discover -s tests`.
