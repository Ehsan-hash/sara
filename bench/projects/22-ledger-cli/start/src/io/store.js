import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DataError } from '../cli/errors.js';
import { Ledger } from '../core/ledger.js';

/** Opens the ledger file (an empty ledger if it doesn't exist yet). ledger.save() writes it back. */
export function openLedger(file) {
  let data;
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new DataError(`${file} is not a ledger file`);
    }
  }
  const ledger = new Ledger(data);
  ledger.save = () => {
    // Write to a temporary file first so a crash never leaves half a ledger.
    writeFileSync(`${file}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  };
  return ledger;
}
