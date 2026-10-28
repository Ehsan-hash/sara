// The real work, as a pure function (easy to test).
export function count(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return { words, lines, characters: [...text].length };
}
