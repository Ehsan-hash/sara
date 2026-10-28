// Phase 10: the container sandbox ("separate user" mode). Runs only on Linux as root (as in Docker);
// run it on a server with: sudo node --test test/sandbox.user.linux.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockDataDir, runCommand, type SandboxInfo } from '../src/tools/sandbox.ts';
import { tempDir } from './helpers.ts';

const skip = process.platform !== 'linux' || process.getuid?.() !== 0 ? 'needs Linux as root (like a container)' : false;

test('separate-user sandbox: commands work in the workspace but cannot read or list Sara data', { skip }, async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const id = (f: string) => Number(String(spawnSync('id', [f, 'nobody']).stdout).trim());
  const sb: SandboxInfo = { mode: 'user', network: true, detail: '', uid: id('-u'), gid: id('-g') };
  const old = process.umask(0o007);
  t.after(() => process.umask(old));
  writeFileSync(join(dir, 'sara.db'), 'secret database', { mode: 0o644 }); // as an older install left it
  writeFileSync(join(dir, 'vault.key'), 'secret key', { mode: 0o600 });
  const ws = join(dir, 'workspaces', 'main');
  mkdirSync(ws, { recursive: true });
  lockDataDir(dir);
  writeFileSync(join(ws, 'from-sara.txt'), 'written by the app');
  const r = await runCommand('id -u; cat ../../sara.db 2>&1; cat ../../vault.key 2>&1; ls ../.. 2>&1; cat from-sara.txt; echo made > mine.txt && cat mine.txt', ws, sb, { timeoutMs: 20_000, signal: AbortSignal.timeout(30_000) });
  const out = r.output;
  assert.match(out, new RegExp(`^${sb.uid}\\n`), 'runs as the tools user');
  assert.match(out, /sara\.db: Permission denied/);
  assert.match(out, /vault\.key: Permission denied/);
  assert.match(out, /ls: cannot open directory '\.\.\/\.\.': Permission denied/);
  assert.match(out, /written by the app\n?made/, 'reads what the app wrote, writes its own');
});
