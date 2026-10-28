import { UsageError } from '../cli/errors.js';
import { normalizeCategory } from '../core/categories.js';
import { parseDate } from '../core/dates.js';
import { formatAmount, parseAmount } from '../core/money.js';

export async function addCommand({ io, values, positionals, ledger, today }) {
  const [amountText, ...words] = positionals;
  if (amountText === undefined) throw new UsageError('add needs an amount and a description');
  const description = words.join(' ').trim();
  if (!description) throw new UsageError('add needs a description');
  const entry = ledger.add({
    amount: parseAmount(amountText),
    description,
    date: values.date ? parseDate(values.date, today) : today,
    category: normalizeCategory(values.category ?? 'other'),
    tags: (values.tag ?? []).map((t) => t.toLowerCase()),
  });
  if (!values.quiet) io.stdout(`added #${entry.id}: ${entry.date} ${formatAmount(entry.amount)} ${entry.description} [${entry.category}]\n`);
}
