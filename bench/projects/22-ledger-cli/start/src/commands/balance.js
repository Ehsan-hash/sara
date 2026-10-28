import { makeFilter } from '../core/filter.js';
import { formatAmount } from '../format/amount.js';

export async function balanceCommand({ io, values, ledger, today }) {
  const rows = ledger.list(makeFilter(values, today));
  io.stdout(`${formatAmount(rows.reduce((n, e) => n + e.amount, 0))}\n`);
}
