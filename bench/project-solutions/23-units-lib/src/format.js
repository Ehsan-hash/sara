// { value, unit } → "2 kilometres" / "2 km". Names and decimals come from the registry.
import './dimensions/index.js';
import { UnitError } from './errors.js';
import { formatNumber } from './numbers.js';
import { getUnit } from './registry.js';

export function format(q, { style = 'long', decimals } = {}) {
  if (!q || typeof q.value !== 'number' || !Number.isFinite(q.value)) throw new UnitError('format() needs { value, unit } with a finite number.');
  const u = getUnit(q.unit);
  if (!u) throw new UnitError(`Unknown unit: ${q.unit}`);
  const text = formatNumber(q.value, decimals ?? u.decimals);
  if (style === 'short') return `${text} ${q.unit}`;
  if (style !== 'long') throw new UnitError(`Unknown style: ${style}`);
  // "1 metre", "0.5 metres", "-1 metre"
  const singular = Math.abs(Number(text.replace(/,/g, ''))) === 1;
  return `${text} ${singular ? u.names.one : u.names.other}`;
}

/** "5 ft 3 in" style: a value split over a list of units, largest first. */
export function formatSplit(value, units, convertFn, { style = 'short' } = {}) {
  const parts = [];
  let rest = value;
  units.forEach((u, i) => {
    const last = i === units.length - 1;
    const inU = i === 0 ? rest : convertFn(rest, units[i - 1], u);
    const whole = last ? inU : Math.trunc(inU + 1e-9);
    if (whole || last) parts.push(format({ value: whole, unit: u }, { style, decimals: last ? undefined : 0 }));
    rest = inU - whole;
  });
  return parts.join(' ');
}
