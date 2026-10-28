# slugify(text, options)

Options: `separator` (default `-`) and `maxLength` (default `60`; `0` means no limit).

1. `ß` becomes `ss` and `&` becomes the word `and` (with a separator on both sides).
2. Accents are removed: `é` becomes `e`, `ü` becomes `u` (decompose with Unicode NFD and drop the
   combining marks).
3. Everything is lowercased.
4. Every run of characters that are not `a-z` or `0-9` becomes **one** separator.
5. Separators at the start and the end are removed.
6. If the result is longer than `maxLength`, it is cut to `maxLength` characters. If the cut falls
   in the middle of a word, the partial word is dropped (cut back to the last separator), unless
   the first word alone is longer than `maxLength`: then it is a hard cut. A separator left at the
   end is removed.

Examples: `Crème Brûlée & Café` → `creme-brulee-and-cafe`; `one two three four` with
`maxLength: 9` → `one-two`; `abcdefghij` with `maxLength: 4` → `abcd`.

# uniqueSlug(text, taken, options)

`taken` is a `Set` of slugs already in use. Returns `slugify(text, options)` if it is free, else
the first free one of `<slug>-2`, `<slug>-3`, … (always joined with `-`).
