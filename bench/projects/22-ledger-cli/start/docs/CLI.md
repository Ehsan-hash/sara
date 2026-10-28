# ledger: command line

```
ledger <command> [options] [arguments]
```

## Options (all commands)

- Long options: `--name value` **or** `--name=value` (the same for every option).
- Short options: `-x value`; several one-letter switches can be grouped: `-qv` is `-q -v`.
- Switches (true/false options) take no value; `--no-name` turns one off.
- An option that can repeat (`--tag`) collects every value in order.
- `--` ends the options: everything after it is an argument, even if it starts with `-`.
- **A negative number is a value, never an option**: `-12.50`, `-5`, `-0.75` and `-1,000.00` are
  arguments (or option values), so `ledger add -12.50 Coffee` and `--min -100` work.
- Unknown options are an error: `error: unknown option --x` (exit code 2). So is a missing value.
- Global options: `--file <path>` (the ledger file), `--help`/`-h`.

## Amounts

- A dot is the decimal separator; commas group thousands: `1234.5`, `1,234.50` and
  `1,234,567.89` are all fine. At most two decimals.
- A leading `-` or parentheses mean money going out: `-12.50`, `(12.50)`. A leading `+` or `$`
  is allowed and ignored.
- Anything else is `invalid amount "<text>"` (exit code 1).
- Printed with two decimals and thousands separators: `-1,234.50`.

## Dates

- `YYYY-MM-DD`, `today`, `yesterday`, or `-<n>d` (n days ago). "Today" is the local date, or
  `$LEDGER_TODAY` when set (tests use it).
- `--since <date>`: entries on or after that day. `--until <date>`: entries on or before that day
  (**the day itself is included**). `--month YYYY-MM`: the whole month, first to last day.

## Commands

| Command | Arguments and options |
|---|---|
| `add <amount> <description…>` | `--date <date>` (default today), `--category <name>` (default `other`), `--tag <t>` (repeat) |
| `list` | filters (below), `--limit <n>`, `--format table\|json\|csv` (default table) |
| `report` | filters, `--by category\|month\|tag` (default category), `--format table\|json\|csv` |
| `balance` | filters; prints the total |
| `remove <id>` | |
| `import <file.csv>` | `--category <name>` for rows without one; columns `date,description,amount[,category]` |
| `export` | filters, `--out <file.csv>` (default: standard output) |

Filters: `--since`, `--until`, `--month`, `--category <name>`, `--tag <t>` (entries with that
tag), `--min <amount>`, `--max <amount>` (inclusive), `--search <text>` (in the description,
any case).

Categories are stored in lower case with spaces as `-`: `Food & Drink` → `food-drink`.
