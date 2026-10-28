# ledger

Keep track of money in a JSON file from the command line. No packages, Node 20+.

```sh
node bin/ledger.js add -4.20 "Coffee" --category food --tag work
node bin/ledger.js add 2,500.00 "Salary" --category income --date 2026-03-01
node bin/ledger.js list --since 2026-03-01 --format table
node bin/ledger.js report --by category --since=2026-01-01 --until=2026-03-31
node bin/ledger.js import bank.csv
```

The ledger file is `--file <path>`, else `$LEDGER_FILE`, else `ledger.json` in the current folder.
Every command and option is described in [docs/CLI.md](docs/CLI.md).

## Layout

| Path | What it is |
|---|---|
| `bin/ledger.js` | The executable: calls `run()` and exits with its code |
| `src/cli/main.js` | `run(argv, io)`: picks the command, parses its options, prints errors |
| `src/cli/args.js` | The one option parser every command uses (since 1.4) |
| `src/cli/help.js` | Usage text |
| `src/commands/` | One file per command, plus `index.js` with each command's options |
| `src/core/` | Amounts (`money.js`), dates (`dates.js`), filters (`filter.js`), categories, the `Ledger` |
| `src/io/` | Reading/writing the ledger file and CSV |
| `src/format/` | Tables and amounts for printing |

## API used by the tests

- `run(argv, io)` from `src/cli/main.js`: `argv` without `node` and the script; `io` is
  `{ stdout(text), stderr(text), env, cwd }`. Resolves to the exit code.
- `parseArgs(argv, spec)` from `src/cli/args.js` (see docs/CLI.md, "Options").
- `parseAmount(text)` and `formatAmount(cents)` from `src/core/money.js` (cents are integers).
- `parseDate(text, today)` from `src/core/dates.js`; `makeFilter(options, today)` from `src/core/filter.js`.
