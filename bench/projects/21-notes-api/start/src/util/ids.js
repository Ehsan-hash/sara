// Short, readable ids: n_1, n_2 … (per prefix, per store).

export function idMaker(prefix) {
  let n = 0;
  return () => `${prefix}_${++n}`;
}
