// Phase 42: the license is in place and a public copy would carry no secrets or private details.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadPrivatePatterns, PRIVATE, scan } from '../scripts/public-export.ts';

const ROOT = join(import.meta.dirname, '..');

test('release: MIT license, credits, and the README points at both', () => {
  const lic = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(lic, /^MIT License/);
  assert.match(lic, /Permission is hereby granted, free of charge/);
  assert.match(lic, /Copyright \(c\) 2026 Frank Arena and Backstage Coding/);
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).license, 'MIT');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /\(LICENSE\)/);
  assert.match(readme, /docs\/CREDITS\.md/);
  const credits = readFileSync(join(ROOT, 'docs', 'CREDITS.md'), 'utf8');
  for (const piece of ['sherpa-onnx', 'Kokoro', 'Open-Meteo', 'OpenStreetMap', 'Claude Code', 'Grok', 'WebView2']) assert.ok(credits.includes(piece), piece);
  // The in-app guide credits the data sources that ask for it.
  const help = readFileSync(join(ROOT, 'web', 'help.html'), 'utf8');
  assert.match(help, /id="credits"/);
  assert.match(help, /Open-Meteo\.com/);
  assert.match(help, /OpenStreetMap contributors/);
});

test('release: the scan catches secrets and private details, and allows test fakes', () => {
  const found = scan([
    { path: 'src/x.ts', text: 'const k = "xai-abcdefghijklmnopqrstuvwxyz0123";\nssh root@example.com\nok line' },
    { path: 'docs/y.md', text: 'see https://sara.backstagecoding.com' },
    { path: 'test/z.test.ts', text: 'const fake = "sk-proj-abcdefghijklmnopqrstuvwxyz";' },
  ]);
  assert.deepEqual(found.filter((f) => f.level === 'fail').map((f) => `${f.file}:${f.line} ${f.kind}`), ['src/x.ts:1 xAI key', 'src/x.ts:2 root SSH login']);
  // The project's own domain is public on purpose (owner decision 2026-10-26).
  assert.deepEqual(found.filter((f) => f.level === 'review'), []);
  // An owner's own details (kept in a git-ignored file) are never allowed, not even in tests, and
  // the finding doesn't echo the value.
  const never: [string, RegExp][] = [['home address of this owner', /\b10\.9\.8\.7\b/]];
  const real = scan([{ path: 'test/ip.test.ts', text: "const ips = ['10.1.2.3', '10.9.8.7'];" }], never);
  assert.deepEqual(real.map((f) => `${f.kind} ${f.text}`), ['home address of this owner (private value hidden)']);
});

test('release: private signing paths are caught in public docs; private patterns load from a file', () => {
  const found = scan([
    { path: 'docs/desktop.md', text: 'Its password is in `~/sara-signing/keychain.pass`.\nBackups are in `.secrets/mac-signing/`.\nGeneric: put it in a keychain of its own.' },
    // Code may name the default password file; only docs are checked for the signing setup.
    { path: 'desktop/mac/build.sh', text: 'KC_PASS="$HOME/sara-signing/keychain.pass"' },
  ]);
  assert.deepEqual(found.map((f) => `${f.file}:${f.line} ${f.kind}`), ['docs/desktop.md:1 private signing setup in public docs', 'docs/desktop.md:2 private signing setup in public docs']);
  assert.ok(PRIVATE.some((re) => re.test('docs/ops/mac-signing.md')));
  const dir = mkdtempSync(join(tmpdir(), 'sara-pp-'));
  const file = join(dir, 'p.json');
  writeFileSync(file, JSON.stringify({ patterns: [{ kind: 'my folder', re: 'users[\\\\/]+jdoe', flags: 'i' }] }));
  const pats = loadPrivatePatterns(file);
  assert.equal(scan([{ path: 'README.md', text: 'C:/Users/JDoe/x' }], pats).length, 1);
  assert.deepEqual(loadPrivatePatterns(join(dir, 'missing.json')), []);
  rmSync(dir, { recursive: true, force: true });
  // The public script itself holds no private values.
  const src = readFileSync(join(ROOT, 'scripts', 'public-export.ts'), 'utf8');
  assert.equal(scan([{ path: 'scripts/public-export.ts', text: src }], loadPrivatePatterns()).length, 0);
});

test('release: the files that would go public have no secrets or private machine details', (t) => {
  let tracked: string[];
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return t.skip('not a git checkout');
  }
  const files = tracked
    .filter((p) => !PRIVATE.some((re) => re.test(p)) && !/\.(png|jpe?g|gif|webp|ico|mp3|wav|jar|jks|zip|gz|bz2|pdf)$/i.test(p) && existsSync(join(ROOT, p)))
    .map((p) => ({ path: p, text: readFileSync(join(ROOT, p), 'utf8') }));
  assert.ok(files.length > 200);
  assert.deepEqual(scan(files, loadPrivatePatterns()).filter((f) => f.level === 'fail'), []);
});
