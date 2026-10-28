# Settings layers

`loadConfig(defaults, file = {}, env = {}, prefix = 'APP')` returns
`merge(merge(defaults, file), fromEnv(env, prefix))`.

## merge(base, override)

- Plain objects are merged key by key, at every depth.
- Any other value in `override` (a string, number, boolean or **array**) replaces the value in
  `base`. Arrays are replaced, never concatenated.
- A key set to `null` in `override` removes that key from the result.
- A key set to `undefined` in `override` is ignored (the base value stays).
- Neither `base` nor `override` is changed.

## fromEnv(env, prefix)

- Only variables that start with `<prefix>_` are used; the prefix and the `_` are dropped.
- A **double** underscore `__` separates levels: `APP_DB__HOST` is `{ db: { host } }`. A single
  underscore is part of the name: `APP_LOG_LEVEL` is `{ log_level }`.
- Names are lowercased.
- Values: `true` and `false` become booleans; text that looks like a number (`5432`, `-3`, `1.5`)
  becomes a number; anything else stays text.
