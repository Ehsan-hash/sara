# measure-units

Parse, format, convert, compare and add up quantities: lengths, masses, volumes and
temperatures. No packages.

```js
import { parse, format, convert, compare, sum, registerUnit } from './src/index.js';

parse('5 ft');                       // { value: 5, unit: 'ft' }
parse('2½ cups') ;                   // fractions and unicode fractions work
format({ value: 2, unit: 'km' });    // "2 kilometres"
format({ value: 2, unit: 'km' }, { style: 'short' }); // "2 km"
convert(1, 'mi', 'km');              // 1.609344
compare({ value: 1, unit: 'kg' }, { value: 900, unit: 'g' }); // 1
sum([{ value: 1, unit: 'm' }, { value: 50, unit: 'cm' }]);    // { value: 1.5, unit: 'm' }
```

## API

- `parse(text)` → `{ value, unit }`. A number (`2`, `2.5`, `-3`, `1,250`, `1/2`, `1 1/2`, `½`, `2½`)
  and a unit written as its symbol, a name or an alias, any case, with or without a space
  (`5ft`, `5 Feet`). Throws `UnitError` for an unknown unit or a missing number.
- `format(q, { style = 'long', decimals })` → text. `long` uses the unit's names ("1 metre",
  "2 metres"), `short` the symbol ("2 m"). Numbers are rounded to the unit's `decimals` (or the
  option), trailing zeros dropped, thousands grouped: "1,250.5 metres".
- `convert(value, from, to)` → number. Units must have the same dimension (else `UnitError`).
- `compare(a, b)` → -1, 0 or 1 (equal within 1e-9 relative), across units of one dimension.
- `sum(list, unit = list[0].unit)` → `{ value, unit }`.
- `unitsOf(dimension)` → the symbols of a dimension, in the order they were defined.
- `registerUnit(def)` adds a unit. `def`: `{ symbol, dimension, factor, offset = 0, names: { one,
  other }, aliases = [], decimals = 2 }`. `factor`/`offset` turn a value into the dimension's base
  unit: `base = value * factor + offset` (bases: m, kg, l, K). After `registerUnit`, the unit works
  **everywhere**: parse (symbol, both names and every alias), format (both styles), convert,
  compare, sum and `unitsOf`. A symbol or alias that is already taken (any case) throws `UnitError`.

Built-in units and their names: [docs/UNITS.md](docs/UNITS.md).
