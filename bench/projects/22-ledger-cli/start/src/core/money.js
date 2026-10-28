// Amounts are integer cents. Rules: docs/CLI.md "Amounts".
import { DataError } from '../cli/errors.js';

export { formatAmount } from '../format/amount.js';

const SHAPE = /^[+-]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

export function parseAmount(text) {
  const raw = String(text ?? '').trim();
  let s = raw;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  if (!SHAPE.test(s)) throw new DataError(`invalid amount "${raw}"`);
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  s = s.replace('$', '').replace(',', '');
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new DataError(`invalid amount "${raw}"`);
  return sign * cents;
}

export function sumAmounts(list) {
  return list.reduce((n, x) => n + x, 0);
}
