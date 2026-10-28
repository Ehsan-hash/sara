import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli/main.js';

export function box(today = '2026-03-31') {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-hidden-'));
  const cli = async (...argv) => {
    let out = '';
    let err = '';
    const code = await run(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t), env: { LEDGER_TODAY: today }, cwd: dir });
    return { code, out, err };
  };
  return { dir, cli, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
export const json = (r) => JSON.parse(r.out);
