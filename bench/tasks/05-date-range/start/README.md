# booking

Dates are plain calendar days written `YYYY-MM-DD`. They mean the same day everywhere, so the
code must give the same answers on a computer in any time zone (work in UTC).

- `eachDay(start, end)`: every day from `start` to `end`, **both included**, as `YYYY-MM-DD`
  strings. If `end` is before `start`, the list is empty.
- `quote(checkIn, checkOut, rate, { weekendRate })`: one night for each day from `checkIn` up to,
  but not including, `checkOut`. Friday and Saturday nights cost `weekendRate` when it is given,
  other nights cost `rate`. Returns `{ nights, total }`. `checkOut` must be after `checkIn`,
  otherwise it throws an `Error`.

Run the tests with `npm test`.
