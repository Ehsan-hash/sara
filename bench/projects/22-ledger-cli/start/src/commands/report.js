import { UsageError } from '../cli/errors.js';
import { makeFilter } from '../core/filter.js';
import { toCsv } from '../io/csv.js';
import { formatAmount } from '../format/amount.js';
import { renderTable } from '../format/table.js';

const KEYS = {
  category: (e) => [e.category],
  month: (e) => [e.date.slice(0, 7)],
  tag: (e) => (e.tags.length ? e.tags : ['(none)']),
};

export async function reportCommand({ io, values, ledger, today }) {
  const keyOf = KEYS[values.by];
  if (!keyOf) throw new UsageError('--by must be category, month or tag');
  const totals = new Map();
  for (const e of ledger.list(makeFilter(values, today))) {
    for (const k of keyOf(e)) {
      const t = totals.get(k) ?? { in: 0, out: 0, count: 0 };
      if (e.amount >= 0) t.in += e.amount;
      else t.out += e.amount;
      t.count++;
      totals.set(k, t);
    }
  }
  const keys = [...totals.keys()].sort(values.by === 'month' ? undefined : (a, b) => totals.get(a).out - totals.get(b).out || a.localeCompare(b));
  const rows = keys.map((k) => ({ key: k, ...totals.get(k), net: totals.get(k).in + totals.get(k).out }));
  if (values.format === 'json') return io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
  if (values.format === 'csv') return io.stdout(toCsv([values.by, 'in', 'out', 'net', 'count'], rows.map((r) => [r.key, formatAmount(r.in, { grouping: false }), formatAmount(r.out, { grouping: false }), formatAmount(r.net, { grouping: false }), r.count])));
  if (values.format !== 'table') throw new UsageError('--format must be table, json or csv');
  if (!rows.length) return io.stdout('No entries.\n');
  const total = rows.reduce((n, r) => n + r.net, 0);
  io.stdout(renderTable([values.by[0].toUpperCase() + values.by.slice(1), 'In', 'Out', 'Net', 'Entries'], [...rows.map((r) => [r.key, formatAmount(r.in), formatAmount(r.out), formatAmount(r.net), String(r.count)]), ['Total', '', '', formatAmount(total), '']], { right: [1, 2, 3, 4] }));
}
