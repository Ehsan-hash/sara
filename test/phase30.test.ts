// Phase 30: upkeep (off-server test restore; logs; health history).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupName, BACKUPS_DIR, createBackup } from '../src/backup.ts';
import { healthReport } from '../src/health.ts';
import { HealthHistory, SAMPLE_MS } from '../src/health-history.ts';
import { hideTokens, Log } from '../src/log.ts';
import { OFFSITE_PASS_VAULT } from '../src/offsite.ts';
import { copyOffsite, offsiteTestDue, testOffsite } from '../src/offsite-run.ts';
import { makeApp, tempDir } from './helpers.ts';
import { exportAll, importAll } from '../src/export.ts';

test('off-server test restore: restores the newest copy into a temporary folder and checks it', async (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-25T20:00:00Z') };
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  const conv = app.store.createConversation({ title: 'Hi' });
  app.store.addMessage(conv.id, 'user', 'hello');
  app.store.addMessage(conv.id, 'assistant', 'hey you');
  const out = join(dir, 'offsite');
  mkdirSync(out);
  mkdirSync(join(dir, BACKUPS_DIR), { recursive: true });
  app.vault.set(OFFSITE_PASS_VAULT, 'a long passphrase');
  app.settings.update({ offsite: { kind: 'folder', path: out, keep: 3 } });
  assert.equal(offsiteTestDue(app), false, 'not before the first copy');

  const name = backupName(clock.now, 'auto');
  createBackup(dir, join(dir, BACKUPS_DIR, name), { saraVersion: 'test', now: clock.now });
  await copyOffsite(app, join(dir, BACKUPS_DIR, name));
  assert.equal(offsiteTestDue(app), true, 'due after the first copy');

  const r = await testOffsite(app);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.name, `${name}.enc`);
  assert.match(r.detail!, /^1 conversations, 2 messages, \d+ files$/);
  assert.equal(app.settings.get().offsite?.lastTest?.ok, true);
  assert.equal(offsiteTestDue(app), false, 'not again within the week');
  assert.deepEqual(existsSync(join(dir, 'tmp')) ? readdirSync(join(dir, 'tmp')) : [], [], 'temporary copy removed');
  assert.equal(app.store.messages(conv.id).length, 2, 'live data untouched');
  assert.ok(healthReport(app, { version: 't', revision: null, startedAt: '' }).checks.some((c) => c.name === 'Off-server test restore' && c.ok));

  clock.now = new Date('2026-11-02T20:00:00Z');
  assert.equal(offsiteTestDue(app), true, 'due a week later');
  // A damaged copy fails, clearly, and health shows it.
  const file = join(out, `${name}.enc`);
  const data = readFileSync(file);
  data[data.length - 10] ^= 0xff;
  writeFileSync(file, data);
  const bad = await testOffsite(app);
  assert.equal(bad.ok, false);
  assert.match(bad.error!, /Wrong passphrase \(or the file is damaged\)/);
  const check = healthReport(app, { version: 't', revision: null, startedAt: '' }).checks.find((c) => c.name === 'Off-server test restore')!;
  assert.equal(check.ok, false);
  assert.match(check.detail, /failed: Wrong passphrase/);
});

test('log: JSON lines, secrets and long tokens hidden, problems listed, rotation at 5 MB', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const log = new Log(dir, (s) => s.replaceAll('vault-secret-1', '[secret]'), () => new Date('2026-10-25T20:00:00Z'));
  log.write('info', 'Sara is listening');
  log.write('warn', 'push failed with vault-secret-1');
  log.write('error', `token ${'A'.repeat(44)} leaked?`);
  assert.equal(log.problems, 2);
  const lines = readFileSync(log.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { level: string; msg: string });
  assert.deepEqual(lines.map((l) => l.level), ['info', 'warn', 'error']);
  assert.equal(lines[1].msg, 'push failed with [secret]');
  assert.equal(lines[2].msg, 'token [hidden] leaked?');
  assert.deepEqual(log.recent({ problems: true }).map((l) => l.level), ['error', 'warn'], 'newest first');
  assert.match(log.text(), /2026-10-25T20:00:00.000Z INFO  Sara is listening/);
  assert.equal(hideTokens('ghp_abcdefghijklmnop123 and a-normal-id-123'), '[hidden] and a-normal-id-123');
  // Rotation: a big file moves to sara.log.1 and a new one starts.
  writeFileSync(log.file, 'x'.repeat(5 * 1024 * 1024 + 10));
  log.write('info', 'after rotation');
  assert.ok(existsSync(`${log.file}.1`));
  assert.equal(readFileSync(log.file, 'utf8').trim().split('\n').length, 1);
});

test('health history: samples, uptime with a gap, reply time; no false downtime before it began', (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-25T10:00:00Z') };
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  let problems = 0;
  const h = new HealthHistory(app.store.db, { now: () => clock.now, problems: () => problems, dataDir: dir });
  // 10:00-10:55 running (12 samples), 11:00-11:55 down, 12:00 running again.
  for (let i = 0; i < 12; i++) {
    if (i === 3) {
      h.turn(1200, false);
      h.turn(800, true);
      problems += 2;
    }
    h.sample();
    clock.now = new Date(clock.now.getTime() + SAMPLE_MS);
  }
  clock.now = new Date('2026-10-25T12:00:00Z');
  h.sample();
  clock.now = new Date('2026-10-25T12:02:00Z');
  const { buckets, up } = h.history({ hours: 24 });
  const at = (iso: string) => buckets.find((b) => b.t === iso)!;
  assert.equal(at('2026-10-25T09:00:00.000Z').up, null, 'before the first sample: no data, not downtime');
  assert.equal(at('2026-10-25T10:00:00.000Z').up, 1);
  assert.equal(at('2026-10-25T10:00:00.000Z').turns, 2);
  assert.equal(at('2026-10-25T10:00:00.000Z').failed, 1);
  assert.equal(at('2026-10-25T10:00:00.000Z').replyMs, 1000);
  assert.equal(at('2026-10-25T10:00:00.000Z').problems, 2);
  assert.equal(at('2026-10-25T11:00:00.000Z').up, 0, 'the gap');
  assert.equal(at('2026-10-25T12:00:00.000Z').up, 1, 'the current hour counts only slots so far');
  assert.equal(up, 0.52, '13 of 25 slots');
  assert.equal(h.history({ days: 7 }).buckets.length, 7);
});

test('export and import keep every kind of memory as itself (dates keep their day, promises whether kept)', (t) => {
  const a = tempDir();
  const b = tempDir();
  const clock = { now: new Date('2026-10-25T20:00:00Z') };
  const from = makeApp(a.dir, clock);
  const to = makeApp(b.dir, clock);
  t.after(() => {
    from.store.close();
    to.store.close();
    a.cleanup();
    b.cleanup();
  });
  const mem = from.memory!;
  mem.add({ kind: 'date', content: "Mom's birthday", onDate: '03-14', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-25' });
  const p = mem.add({ kind: 'promise', content: 'Alex will call his mom.', onDate: '2026-10-30', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-25' });
  mem.resolve(p.id, '2026-10-26T10:00:00.000Z');
  mem.add({ kind: 'reflection', content: 'Mondays are rough for Alex.', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-25' });
  importAll(to, JSON.parse(JSON.stringify(exportAll(from))));
  const got = to.memory!.list().map((m) => [m.kind, m.content, m.onDate, m.resolvedAt]).sort();
  assert.deepEqual(got, [
    ['date', "Mom's birthday", '03-14', null],
    ['promise', 'Alex will call his mom.', '2026-10-30', '2026-10-26T10:00:00.000Z'],
    ['reflection', 'Mondays are rough for Alex.', null, null],
  ]);
});
