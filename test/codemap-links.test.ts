// H1 (pre-1.0 hardening): code_map's entry-point reads (README, package.json, go.mod, Makefile,
// .gitignore) must never follow a link out of the workspace.
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readInsideNoFollow } from '../src/codemap/safe-read.ts';
import { CodeMapStore } from '../src/codemap/store.ts';
import { entryPoints } from '../src/codemap/tools.ts';
import { tempDir } from './helpers.ts';

function canLink(dir: string): boolean {
  try {
    writeFileSync(join(dir, 'probe-target'), 'x');
    symlinkSync(join(dir, 'probe-target'), join(dir, 'probe-link'), 'file');
    return true;
  } catch {
    return false;
  }
}

test('code_map: links to files outside the workspace are never read (README, package.json, go.mod, .gitignore)', (t) => {
  const { dir, cleanup } = tempDir();
  let store: CodeMapStore | undefined;
  t.after(() => {
    store?.close();
    cleanup();
  });
  if (!canLink(dir)) {
    t.skip('this account may not create symbolic links');
    return;
  }
  const secret = join(dir, 'owner.json');
  writeFileSync(secret, 'SECRET-LINE-1 sessionSecret=abc123\nline2\n');
  writeFileSync(join(dir, 'pkg-secret.json'), JSON.stringify({ name: 'LEAKED-NAME', main: 'leak.js' }));
  writeFileSync(join(dir, 'gomod-secret'), 'module leaked.example/secret\n');
  const outsideDir = join(dir, 'outside');
  mkdirSync(outsideDir);
  writeFileSync(join(outsideDir, 'Makefile'), 'leaktarget:\n\techo hi\n');
  const ws = join(dir, 'ws');
  mkdirSync(join(ws, 'src'), { recursive: true });
  writeFileSync(join(ws, 'src', 'main.ts'), 'export function main() { return 1; }\n');
  symlinkSync(secret, join(ws, 'README.md'), 'file');
  symlinkSync(join(dir, 'pkg-secret.json'), join(ws, 'package.json'), 'file');
  symlinkSync(join(dir, 'gomod-secret'), join(ws, 'go.mod'), 'file');
  symlinkSync(secret, join(ws, '.gitignore'), 'file');
  // A linked folder: its files are plain files, but they live outside the workspace.
  try {
    symlinkSync(outsideDir, join(ws, 'sub'), 'junction');
  } catch {
    /* folder links not allowed: the file links above still cover the finding */
  }
  // A plain file inside still reads.
  writeFileSync(join(ws, 'Cargo.toml'), '[package]\nname = "inside-ok"\n');

  store = new CodeMapStore(ws, join(dir, 'map.db'));
  let r = store.refresh(0);
  for (let i = 0; !r.done && i < 1000; i++) r = store.refresh(0);
  const out = entryPoints(ws, '', store).join('\n');
  assert.doesNotMatch(out, /SECRET|sessionSecret|LEAKED|leaked\.example/, out);
  assert.match(out, /Cargo\.toml "inside-ok"/);
  const sub = entryPoints(ws, 'sub', store).join('\n');
  assert.doesNotMatch(sub, /leaktarget/, sub);

  assert.equal(readInsideNoFollow(ws, join(ws, 'README.md')), null);
  assert.equal(readInsideNoFollow(ws, join(ws, 'sub', 'Makefile')), null);
  assert.equal(readInsideNoFollow(ws, join(ws, '..', 'owner.json')), null);
  assert.equal(readInsideNoFollow(ws, join(ws, 'Cargo.toml'))?.toString('utf8').includes('inside-ok'), true);
});
