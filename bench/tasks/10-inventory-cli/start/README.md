# inv

```sh
node bin/inv.js list stock.json [--format table|csv|json] [--low N]
```

The file holds `{ "items": [{ "sku": "A1", "name": "Bolt", "qty": 120 }, …] }`. Items are always
printed in the order of the file.

- `--format table` (the default) prints a `NAME  QTY` table, as it does today.
- `--format csv` prints a header line `sku,name,qty` and one line per item. A field that contains
  a comma or a double quote is wrapped in double quotes, with each `"` inside written as `""`.
- `--format json` prints the items as a JSON array, indented with 2 spaces.
- `--low N` lists only the items with `qty` **below** `N` (works with every format).
- Options may be written `--format csv` or `--format=csv`, in any order after the file name.
- An unknown format prints `unknown format: <name>` to standard error and exits with code `2`.
- A wrong command or a missing file name prints the usage line and exits with code `1`.

Run the tests with `npm test`. There's a sample file in `stock.json`.
