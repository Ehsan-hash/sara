// One filter for list, report, balance and export (since 1.4). Rules: docs/CLI.md "Filters".
import { DataError } from '../cli/errors.js';
import { normalizeCategory } from './categories.js';
import { compareDates, monthRange, parseDate } from './dates.js';
import { parseAmount } from './money.js';

/** The date window [from, to] the options ask for (both days included); either end may be missing. */
export function dateWindow(values, today) {
  let from = values.since !== undefined ? parseDate(values.since, today) : undefined;
  let to = values.until !== undefined ? parseDate(values.until, today) : undefined;
  if (values.month !== undefined) {
    const m = monthRange(values.month);
    from = from && compareDates(from, m.first) > 0 ? from : m.first;
    to = to && compareDates(to, m.last) < 0 ? to : m.last;
  }
  if (from && to && compareDates(from, to) > 0) throw new DataError('--since is after --until');
  return { from, to };
}

export function makeFilter(values, today) {
  const { from, to } = dateWindow(values, today);
  const category = values.category !== undefined ? normalizeCategory(values.category) : undefined;
  const tag = values.tag?.toLowerCase();
  const min = values.min !== undefined ? parseAmount(values.min) : undefined;
  const max = values.max !== undefined ? parseAmount(values.max) : undefined;
  const search = values.search?.toLowerCase();
  return (e) =>
    (!from || compareDates(e.date, from) >= 0) &&
    (!to || compareDates(e.date, to) <= 0) &&
    (!category || e.category === category) &&
    (!tag || e.tags.includes(tag)) &&
    (min === undefined || e.amount >= min) &&
    (max === undefined || e.amount <= max) &&
    (!search || e.description.toLowerCase().includes(search));
}
