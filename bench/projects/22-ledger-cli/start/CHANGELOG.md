# Changelog

## 1.4.1

- `report --by month` sorts months in order.

## 1.4.0

- **Option parsing moved into one shared parser, `src/cli/args.js`.** Each command used to parse
  its own options; now `src/commands/index.js` declares them and `main.js` parses them once.
- **Amounts** are parsed in one place, `src/core/money.js` (was in `add.js` and `import.js`).
- **Date filters** (`--since`, `--until`, `--month`) moved into `src/core/filter.js`.
- New: `--format csv` for `list` and `report`.

## 1.3.2

- `import` accepts amounts in parentheses for money going out: `(12.00)`.
