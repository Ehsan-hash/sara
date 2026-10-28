// Static checks on the browser code (no build step, so nothing else catches these).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from './helpers.ts';

test('web: every api(...) call starts with a "/" path (a typo once broke "Forget")', () => {
  const bad: string[] = [];
  for (const f of readdirSync(join(ROOT, 'web')).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(ROOT, 'web', f), 'utf8');
    for (const m of src.matchAll(/\bapi\(\s*([`'"])(.)/g)) {
      if (m[2] !== '/') bad.push(`${f}: ${src.slice(m.index, m.index + 40)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('web: element ids are unique; every window and settings page is well formed', () => {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, [], 'duplicate ids');
  const pages = [...html.matchAll(/<section class="settings-page" data-page="([\w-]+)" data-group="([^"]+)" data-title="([^"]+)"/g)];
  assert.ok(pages.length >= 20, `settings pages: ${pages.length}`);
  // Every control the Settings code reads is still on some page.
  const app = readFileSync(join(ROOT, 'web', 'app.js'), 'utf8');
  const missing = [...new Set([...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]))].filter((id) => !ids.includes(id) && !/^(sd-|td-)?$/.test(id));
  assert.deepEqual(missing, [], 'app.js refers to ids that are not in index.html');
  // Windows close with ✕ / Esc / outside click: no leftover "Close" buttons.
  assert.doesNotMatch(html, />Close<\/button>/);
});
