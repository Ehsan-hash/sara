import { UsageError } from '../cli/errors.js';

export async function removeCommand({ io, positionals, ledger }) {
  const id = Number(positionals[0]);
  if (!Number.isInteger(id)) throw new UsageError('remove needs an entry id');
  if (!ledger.remove(id)) throw new UsageError(`no entry #${id}`, 1);
  io.stdout(`removed #${id}\n`);
}
