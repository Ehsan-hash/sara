# textstats

```python
from textstats import tokenize, word_counts, top_words, summary
```

- `tokenize(text)`: the words of a text, lowercased, in order.
  - A word is a run of letters (any language: `café` is one word) and digits.
  - Apostrophes inside a word keep it together: `don't` and `rock'n'roll` are one word each. The
    curly apostrophe `’` counts as `'` (so `It’s` gives `it's`). Apostrophes at the start or end
    of a word are not part of it (`'quoted'` gives `quoted`).
  - Everything else separates words, including hyphens, dashes and underscores (`well-known` is
    `well` and `known`).
- `word_counts(text)`: a `collections.Counter` of the words.
- `top_words(text, n=10, stopwords=None)`: the `n` most common words as `(word, count)` pairs,
  most common first; equal counts in alphabetical order. Words in `stopwords` (compared without
  regard to case) are left out.
- `summary(text)`: a dict with `words` (how many), `unique` (how many different), `top` (the
  `top_words` with `n=3`) and `avg_word_length` (rounded to 2 decimals; `0.0` for no words).

Run the tests with `python -m unittest discover -s tests`.
