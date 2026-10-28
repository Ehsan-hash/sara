# Open issues (since 1.4.0)

## #12 Negative amounts don't work any more

```
$ ledger add -12.50 "Coffee beans"
error: unknown option -1
```

It worked in 1.3. Same for `ledger list --min -100`.

## #13 `--since=2026-01-01` is rejected

`ledger report --since 2026-01-01` works, but `ledger report --since=2026-01-01` says
`error: unknown option --since=2026-01-01`. The docs say both forms work, for every option.

## #15 `--until` leaves out the last day

`ledger list --until 2026-03-31` doesn't show what I spent on March 31. Same with
`--month 2026-03`: the 31st is missing.

## #16 Big amounts from my bank's CSV are rejected

My bank writes `1,234,567.89`. `ledger import` stops with `invalid amount "1,234,567.89"`.
`1,234.50` is fine.
