import { splitRows } from './rows.js';
import { splitFields } from './fields.js';

export function parseCsv(text) {
  return splitRows(text).map(splitFields);
}

export function toObjects(text) {
  const [head, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
