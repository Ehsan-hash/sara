// The work itself, separate from the command line so it's easy to test.

/** Counts lines, words and characters (like `wc`). */
export function count(text) {
  const lines = text === '' ? 0 : text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
  const words = (text.match(/\S+/g) ?? []).length;
  return { lines, words, chars: [...text].length };
}

/** The most common words (lower case, letters only), most frequent first. */
export function topWords(text, n = 5) {
  const counts = new Map();
  for (const w of text.toLowerCase().match(/\p{L}[\p{L}'-]*/gu) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([word, times]) => ({ word, times }));
}
