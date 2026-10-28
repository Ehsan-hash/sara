# gradebook

- `weighted_average(scores, weights)`: the sum of `score * weight` divided by the **sum of the
  weights**. A missing score (`None`) counts as 0.
- `letter(avg)`: `A` from 90 up, `B` from 80, `C` from 70, `D` from 60, otherwise `F` (so exactly
  90 is an `A`).
- `rank(students, weights)`: `students` maps a name to a list of scores. Returns a list of
  `(place, name, average, letter)`, best average first, with the average rounded to 1 decimal
  (the letter uses the unrounded average). Students whose averages are equal when rounded to 2
  decimals share a place, and the next place skips (1, 2, 2, 4). Within a shared place, names are
  in alphabetical order.

Run the tests with `python -m unittest discover -s tests`.
