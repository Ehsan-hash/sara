import { parseDate } from './dates.js';
import { eachDay } from './range.js';

/** Price of a stay (see README.md). */
export function quote(checkIn, checkOut, rate, opts = {}) {
  if (parseDate(checkOut) <= parseDate(checkIn)) throw new Error('Check-out must be after check-in.');
  const days = eachDay(checkIn, checkOut).slice(0, -1);
  let total = 0;
  for (const day of days) {
    const weekday = parseDate(day).getUTCDay();
    const weekend = weekday === 5 || weekday === 6;
    total += weekend && opts.weekendRate != null ? opts.weekendRate : rate;
  }
  return { nights: days.length, total };
}
