import { UsageError } from '../cli/errors.js';
import { makeFilter } from '../core/filter.js';
import { toCsv } from '../io/csv.js';
import { formatAmount } from '../format/amount.js';
import { renderTable } from '../format/table.js';

export async function listCommand({ io, values, ledger, today }) {
  let rows = ledger.list(makeFilter(values, today));
  if (values.limit !== undefined) {
    const n = Number(values.limit);
    if (!Number.isInteger(n) || n < 1) throw new UsageError('--limit must be a whole number above 0');
    rows = rows.slice(-n);
  }
  if (values.format === 'json') return io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
  if (values.format === 'csv') return io.stdout(toCsv(['id', 'date', 'description', 'amount', 'category', 'tags'], rows.map((e) => [e.id, e.date, e.description, formatAmount(e.amount, { grouping: false }), e.category, e.tags.join(' ')])));
  if (values.format !== 'table') throw new UsageError('--format must be table, json or csv');
  if (!rows.length) return io.stdout('No entries.\n');
  io.stdout(renderTable(['#', 'Date', 'Description', 'Amount', 'Category'], rows.map((e) => [String(e.id), e.date, e.description, formatAmount(e.amount), e.category]), { right: [3] }));
}
