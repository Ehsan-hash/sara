// Phase 63: server logs: JSON lines, levels, an extra rotated log file, secrets never written.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Log, logOptions, RotatingFile } from '../src/log.ts';
import { Redactor } from '../src/redact.ts';
import { tempDir } from './helpers.ts';

const at = () => new Date('2026-10-28T12:00:00Z');

/** A console stand-in that records what was printed. */
function fakeConsole() {
  const out: { method: string; text: string }[] = [];
  const rec = (method: string) => (...a: unknown[]) => out.push({ method, text: a.map(String).join(' ') });
  return { out, target: { log: rec('log'), info: rec('info'), debug: rec('debug'), warn: rec('warn'), error: rec('error') } };
}

test('log options: defaults stay as before; bad values fall back', () => {
  assert.deepEqual(logOptions({}), { format: 'text', level: 'info', maxBytes: 10 * 1024 * 1024, keep: 5 });
  const o = logOptions({ SARA_LOG_FORMAT: 'JSON', SARA_LOG_LEVEL: 'warn', SARA_LOG_FILE: '/var/log/sara/sara.log', SARA_LOG_MAX_MB: '2', SARA_LOG_KEEP: '3' });
  assert.equal(o.format, 'json');
  assert.equal(o.level, 'warn');
  assert.match(o.file ?? '', /sara\.log$/);
  assert.equal(o.maxBytes, 2 * 1024 * 1024);
  assert.equal(o.keep, 3);
  assert.deepEqual(logOptions({ SARA_LOG_FORMAT: 'xml', SARA_LOG_LEVEL: 'loud', SARA_LOG_MAX_MB: '0', SARA_LOG_KEEP: '-1' }), { format: 'text', level: 'info', maxBytes: 10 * 1024 * 1024, keep: 5 });
});

test('console: text by default (the message as printed), JSON lines when asked, warn/error to stderr', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const text = fakeConsole();
  new Log(dir, undefined, at).captureConsole(text.target);
  text.target.log('Sara is listening on %s', 'http://127.0.0.1:7860');
  assert.deepEqual(text.out, [{ method: 'log', text: 'Sara is listening on http://127.0.0.1:7860' }]);

  const { dir: d2, cleanup: c2 } = tempDir();
  t.after(c2);
  const json = fakeConsole();
  new Log(d2, undefined, at, logOptions({ SARA_LOG_FORMAT: 'json' })).captureConsole(json.target);
  json.target.warn('push failed:', 'timeout');
  json.target.log('two\nlines');
  assert.equal(json.out[0].method, 'warn');
  assert.deepEqual(JSON.parse(json.out[0].text), { t: '2026-10-28T12:00:00.000Z', level: 'warn', msg: 'push failed: timeout' });
  assert.equal(json.out[1].text.split('\n').length, 1, 'one line per entry');
  assert.equal(JSON.parse(json.out[1].text).msg, 'two\nlines');
});

test('levels: quieter lines are left out of the console and the files; debug only when asked', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const c = fakeConsole();
  const log = new Log(dir, undefined, at, logOptions({ SARA_LOG_LEVEL: 'warn' }));
  log.captureConsole(c.target);
  c.target.debug('details');
  c.target.log('started');
  c.target.warn('slow model');
  c.target.error('crashed');
  assert.deepEqual(c.out.map((o) => o.method), ['warn', 'error']);
  assert.deepEqual(log.recent().map((l) => l.level), ['error', 'warn']);
  assert.equal(log.problems, 2);

  const { dir: d2, cleanup: c2 } = tempDir();
  t.after(c2);
  const dbg = fakeConsole();
  const all = new Log(d2, undefined, at, logOptions({ SARA_LOG_LEVEL: 'debug' }));
  all.captureConsole(dbg.target);
  dbg.target.debug('details');
  assert.deepEqual(all.recent().map((l) => l.level), ['debug']);
  assert.deepEqual(all.recent({ problems: true }), [], 'debug lines are not problems');

  const { dir: d3, cleanup: c3 } = tempDir();
  t.after(c3);
  const quiet = fakeConsole();
  new Log(d3, undefined, at).captureConsole(quiet.target);
  quiet.target.debug('details');
  assert.deepEqual(quiet.out, [], 'debug is off by default');
});

test('secrets: the Redactor and the token rule apply to the console, the data log and the extra file', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const redactor = new Redactor(() => ['vault-secret-value-1']);
  const extra = join(dir, 'ext', 'sara.log');
  const c = fakeConsole();
  const log = new Log(dir, (s) => redactor.redact(s), at, logOptions({ SARA_LOG_FILE: extra, SARA_LOG_FORMAT: 'json' }));
  log.captureConsole(c.target);
  c.target.warn('provider said: bad key vault-secret-value-1 for sk-proj-abcdefghijklmnopqrstuvwxyz and Bearer abcdefghijklmnopqrstuvwxyz0123');
  c.target.log(`owner token ${'Z'.repeat(43)}`);
  const everywhere = [c.out.map((o) => o.text).join('\n'), readFileSync(log.file, 'utf8'), readFileSync(extra, 'utf8')];
  for (const s of everywhere) {
    assert.doesNotMatch(s, /vault-secret-value-1|sk-proj-abc|abcdefghijklmnopqrstuvwxyz0123|ZZZZZZZZZZ/);
    assert.match(s, /\[REDACTED\]/);
    assert.match(s, /\[hidden\]/);
  }
});

test('extra log file: text lines by default, rotated in-process at the size limit, keeping N old files', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const extra = join(dir, 'logs-out', 'sara.log');
  const log = new Log(dir, undefined, at, { ...logOptions({ SARA_LOG_FILE: extra, SARA_LOG_KEEP: '2' }), maxBytes: 1000 });
  for (let i = 0; i < 60; i++) log.write('info', `line ${String(i).padStart(2, '0')} ${'x y '.repeat(10)}`);
  const files = readdirSync(join(dir, 'logs-out')).sort();
  assert.deepEqual(files, ['sara.log', 'sara.log.1', 'sara.log.2'], 'two old files kept, the oldest dropped');
  for (const f of files) assert.ok(readFileSync(join(dir, 'logs-out', f)).length <= 1000, `${f} under the limit`);
  const newest = readFileSync(extra, 'utf8').trim().split('\n');
  assert.match(newest.at(-1)!, /^2026-10-28T12:00:00\.000Z INFO {2}line 59 (x y ?)+$/);
  // Order across files: .2 is older than .1, which is older than the current file.
  const first = (f: string) => Number(/line (\d+)/.exec(readFileSync(join(dir, 'logs-out', f), 'utf8'))![1]);
  assert.ok(first('sara.log.2') < first('sara.log.1') && first('sara.log.1') < first('sara.log'));
  // The data log is unchanged: JSON lines, its own 5 MB rotation.
  assert.ok(!existsSync(`${log.file}.1`));
  assert.equal(JSON.parse(readFileSync(log.file, 'utf8').split('\n')[0]).level, 'info');
});

test('rotating file: one line bigger than the limit still gets written', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const f = new RotatingFile(join(dir, 'a.log'), 10, 1);
  f.write('0123456789abcdef\n');
  f.write('next\n');
  assert.equal(readFileSync(join(dir, 'a.log'), 'utf8'), 'next\n');
  assert.equal(readFileSync(join(dir, 'a.log.1'), 'utf8'), '0123456789abcdef\n');
});
