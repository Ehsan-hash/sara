import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataError, UsageError } from '../cli/errors.js';
import { normalizeCategory } from '../core/categories.js';
import { parseDate } from '../core/dates.js';
import { parseAmount } from '../core/money.js';
import { parseCsv } from '../io/csv.js';

export async function importCommand({ io, values, positionals, ledger, today }) {
  if (!positionals[0]) throw new UsageError('import needs a CSV file');
  const rows = parseCsv(readFileSync(resolve(io.env.PWD ?? io.cwd, positionals[0]), 'utf8'));
  const [head, ...data] = rows;
  const col = (name) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const [d, desc, amt, cat] = ['date', 'description', 'amount', 'category'].map(col);
  if (d < 0 || desc < 0 || amt < 0) throw new DataError('the CSV needs date, description and amount columns');
  let n = 0;
  data.forEach((r, i) => {
    if (r.every((c) => !c.trim())) return;
    try {
      ledger.add({
        date: parseDate(r[d].trim(), today),
        description: r[desc].trim(),
        amount: parseAmount(r[amt]),
        category: normalizeCategory((cat >= 0 && r[cat]?.trim()) || values.category || 'other'),
        tags: [],
      });
      n++;
    } catch (err) {
      throw new DataError(`line ${i + 2}: ${err.message}`);
    }
  });
  if (!values.quiet) io.stdout(`imported ${n} ${n === 1 ? 'entry' : 'entries'}\n`);
}
