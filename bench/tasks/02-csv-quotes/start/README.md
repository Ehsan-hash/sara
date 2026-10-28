# csv

A tiny CSV reader.

- `parseCsv(text)` returns an array of rows; each row is an array of strings.
- Fields are separated by commas. Rows end with `\n` or `\r\n`.
- A field may be wrapped in double quotes. Inside quotes, commas and line breaks are part of the
  field, and two double quotes (`""`) stand for one double quote.
- A line break at the very end of the text does not start an extra, empty row. Empty text gives `[]`.
- Empty fields are kept: `a,,c` is `['a', '', 'c']`.
- `toObjects(text)` uses the first row as the names of the columns and returns one object per
  following row (a missing field becomes `''`).

Run the tests with `npm test`.
