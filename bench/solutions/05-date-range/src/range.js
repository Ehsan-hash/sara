import { addDays, formatDate, parseDate } from './dates.js';

/** Every day from start to end, both included, as YYYY-MM-DD strings. */
export function eachDay(start, end) {
  const out = [];
  for (let d = parseDate(start); d <= parseDate(end); d = addDays(d, 1)) out.push(formatDate(d));
  return out;
}
