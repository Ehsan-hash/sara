// Dates are local calendar days as "YYYY-MM-DD" strings. Rules: docs/CLI.md "Dates".
import { DataError } from '../cli/errors.js';

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Today's date: $LEDGER_TODAY if set, else the local date. */
export function todayFrom(env) {
  if (env.LEDGER_TODAY) return parseDate(env.LEDGER_TODAY, '1970-01-01');
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return ymd(new Date(`${s}T00:00:00Z`)) === s;
}

export function parseDate(text, today) {
  const s = String(text ?? '').trim().toLowerCase();
  if (s === 'today') return today;
  if (s === 'yesterday') return addDays(today, -1);
  const rel = /^-(\d{1,4})d$/.exec(s);
  if (rel) return addDays(today, -Number(rel[1]));
  if (isValidDate(s)) return s;
  throw new DataError(`invalid date "${text}" (use YYYY-MM-DD, today, yesterday or -7d)`);
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(text) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new DataError(`invalid month "${text}" (use YYYY-MM)`);
  const first = `${m[1]}-${m[2]}-01`;
  const next = Number(m[2]) === 12 ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${pad(Number(m[2]) + 1)}-01`;
  return { first, last: addDays(next, -1) };
}

export function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
