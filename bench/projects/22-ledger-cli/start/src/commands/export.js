import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeFilter } from '../core/filter.js';
import { toCsv } from '../io/csv.js';
import { formatAmount } from '../format/amount.js';

export async function exportCommand({ io, values, ledger, today }) {
  const rows = ledger.list(makeFilter(values, today));
  const csv = toCsv(['date', 'description', 'amount', 'category', 'tags'], rows.map((e) => [e.date, e.description, formatAmount(e.amount, { grouping: false }), e.category, e.tags.join(' ')]));
  if (values.out) {
    writeFileSync(resolve(io.cwd, values.out), csv);
    io.stdout(`wrote ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} to ${values.out}\n`);
  } else io.stdout(csv);
}
