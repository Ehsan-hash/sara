import { parseDate } from './dates.js';
import { eachDay } from './range.js';

/** Price of a stay (see README.md). */
export function quote(checkIn, checkOut, rate, opts = {}) {
  const days = eachDay(checkIn, checkOut).slice(0, -1);
  let total = 0;
  for (const day of days) {
    const weekday = parseDate(day).getDay();
    const weekend = weekday === 5 || weekday === 6;
    total += weekend && opts.weekendRate != null ? opts.weekendRate : rate;
  }
  return { nights: days.length, total };
}
