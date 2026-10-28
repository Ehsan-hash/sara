// Numbers as people write them: 2, 2.5, -3, 1,250, 1/2, 1 1/2, ½, 2½.
const VULGAR = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const VULGAR_CLASS = Object.keys(VULGAR).join('');

/** The number at the start of the text: { value, rest } or undefined. */
export function leadingNumber(text) {
  const s = text.trimStart();
  let m = new RegExp(`^(-?\\d+)\\s*([${VULGAR_CLASS}])`).exec(s);
  if (m) return { value: Number(m[1]) + Math.sign(Number(m[1]) || 1) * VULGAR[m[2]], rest: s.slice(m[0].length) };
  m = new RegExp(`^(-?)([${VULGAR_CLASS}])`).exec(s);
  if (m) return { value: (m[1] ? -1 : 1) * VULGAR[m[2]], rest: s.slice(m[0].length) };
  m = /^(-?\d+)\s+(\d+)\/(\d+)(?![\d.])/.exec(s);
  if (m && Number(m[3])) return { value: Number(m[1]) + Math.sign(Number(m[1]) || 1) * (Number(m[2]) / Number(m[3])), rest: s.slice(m[0].length) };
  m = /^(-?\d+)\/(\d+)(?![\d.])/.exec(s);
  if (m && Number(m[2])) return { value: Number(m[1]) / Number(m[2]), rest: s.slice(m[0].length) };
  m = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|^-?\.\d+/.exec(s);
  if (m) return { value: Number(m[0].replace(/,/g, '')), rest: s.slice(m[0].length) };
  return undefined;
}

/** Rounds to `decimals` places, drops trailing zeros, groups thousands: 1250.5 → "1,250.5". */
export function formatNumber(value, decimals) {
  const f = 10 ** decimals;
  let r = Math.round(value * f) / f;
  if (Object.is(r, -0)) r = 0;
  const [whole, frac] = r.toFixed(decimals).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = frac ? frac.replace(/0+$/, '') : '';
  return `${sign}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

export function nearlyEqual(a, b, rel = 1e-9) {
  return a === b || Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300);
}
