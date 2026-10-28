import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli/main.js';

/** A ledger in a temporary folder; cli(...args) runs a command and returns { code, out, err }. */
export function sandbox(today = '2026-03-15') {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
  const cli = async (...argv) => {
    let out = '';
    let err = '';
    const code = await run(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t), env: { LEDGER_TODAY: today }, cwd: dir });
    return { code, out, err };
  };
  return { dir, cli, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
