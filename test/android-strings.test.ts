// The Android app's own text (android/app/src/main/res/values*/strings.xml): the same strings in
// all six languages, with the same placeholders, and every one of them used by the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const LANGS = ['values', 'values-de', 'values-es', 'values-fr', 'values-it', 'values-pt-rBR'];

function strings(dir: string): Map<string, string> {
  const xml = readFileSync(join(RES, dir, 'strings.xml'), 'utf8');
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<string name="([\w]+)"([^>]*)>([\s\S]*?)<\/string>/g)) {
    if (!/translatable="false"/.test(m[2] ?? '')) out.set(m[1] ?? '', m[3] ?? '');
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/%\d+\$[sd]/g)].map((m) => m[0]).sort().join(',');

test('Android strings: every language has the same names and placeholders as English', () => {
  const en = strings('values');
  assert.ok(en.size > 50, 'the app text lives in strings.xml');
  for (const dir of LANGS.slice(1)) {
    const other = strings(dir);
    assert.deepEqual([...other.keys()].sort(), [...en.keys()].sort(), `${dir}/strings.xml has the same strings`);
    for (const [k, v] of en) {
      assert.equal(placeholders(other.get(k) ?? ''), placeholders(v), `${dir}: ${k} keeps its placeholders`);
      assert.ok(!/(^|[^\\])'/.test(other.get(k) ?? ''), `${dir}: ${k} escapes its apostrophes`);
    }
  }
});

test('Android strings: every string is used (no dead text), and the code has no English left in dialogs', () => {
  const java = join(ROOT, 'android', 'app', 'src', 'main', 'java', 'com', 'backstagecoding', 'sara');
  let code = '';
  for (const f of readdirSync(java)) code += readFileSync(join(java, f), 'utf8');
  const xml = ['AndroidManifest.xml', 'res/xml/shortcuts.xml', 'res/xml/widget_info.xml', 'res/layout/widget.xml']
    .map((f) => readFileSync(join(ROOT, 'android', 'app', 'src', 'main', f), 'utf8'))
    .join('\n');
  for (const k of strings('values').keys()) {
    assert.ok(code.includes(`R.string.${k}`) || xml.includes(`@string/${k}`), `${k} is used`);
  }
  // Dialog titles, buttons, notification text and toasts come from strings.xml.
  assert.doesNotMatch(code, /\.set(Title|Message|ContentTitle|ContentText|Label)\("[A-Z]/);
  assert.doesNotMatch(code, /Toast\.makeText\([^,]+, "[A-Z]/);
  assert.doesNotMatch(code, /new NotificationChannel\([^,]+, "/);
});
