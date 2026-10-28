// Phase 6: backup/restore round trip (database, vault + key, settings, workspaces), safety checks,
// automatic daily backups with pruning, health + backup API, and the CLI.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { OwnerAuth } from '../src/auth.ts';
import { autoBackupTick, BACKUPS_DIR, createBackup, inspectBackup, listBackups, readTar, restoreBackup, writeTar } from '../src/backup.ts';
import { createSaraServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const run = promisify(execFile);

test('tar writer/reader: long names (pax), binary data, empty files', () => {
  const long = `workspaces/main/${'deep/'.repeat(30)}file.txt`;
  const entries = [
    { path: 'a.txt', data: Buffer.from('hello'), mode: 0o644 },
    { path: long, data: Buffer.from([0, 1, 2, 255]), mode: 0o600 },
    { path: 'empty', data: Buffer.alloc(0), mode: 0o644 },
  ];
  const back = readTar(writeTar(entries));
  assert.deepEqual(back.map((e) => [e.path, [...e.data]]), entries.map((e) => [e.path, [...e.data]]));
  assert.equal(back[1].mode & 0o777, 0o600);
});

test('backup → restore into a fresh folder: conversations, keys, settings, workspaces come back', async (t) => {
  const { dir, cleanup } = tempDir();
  const { dir: dir2, cleanup: cleanup2 } = tempDir();
  t.after(() => {
    cleanup();
    cleanup2();
  });
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  const conv = app.store.createConversation({ title: 'BBQ plans' });
  app.store.addMessage(conv.id, 'user', 'Smoke the brisket Saturday');
  app.vault.set('provider:openai', 'sk-test-secret-value-123');
  app.settings.update({ ownerName: 'Alex' });
  mkdirSync(join(dir, 'workspaces', 'main', 'proj'), { recursive: true });
  writeFileSync(join(dir, 'workspaces', 'main', 'proj', 'notes.md'), '# hi');
  mkdirSync(join(dir, 'snapshots', 'x'), { recursive: true });
  writeFileSync(join(dir, 'snapshots', 'x', 'big'), 'undo history');
  // Backup while the database is open and has un-checkpointed WAL data.
  const file = join(dir, BACKUPS_DIR, 'sara-test.tar.gz');
  const m = createBackup(dir, file, { saraVersion: '0.6.1' });
  assert.equal(m.saraVersion, '0.6.1');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600, 'backup is private');
  const { entries } = inspectBackup(file);
  const names = entries.map((e) => e.path);
  assert.ok(names.includes('sara.db') && names.includes('master.key') && names.includes('workspaces/main/proj/notes.md'));
  assert.ok(!names.some((n) => n.startsWith('snapshots/') || n.startsWith('tmp/') || n.startsWith('backups/') || n.endsWith('-wal')));
  app.store.close();

  // Restore somewhere else that already has data: old data is moved aside, not deleted.
  writeFileSync(join(dir2, 'settings.json'), '{"providers":[],"ownerName":"Someone else"}');
  const r = restoreBackup(file, dir2);
  assert.ok(existsSync(join(r.movedTo, 'settings.json')));
  const store = new Store(join(dir2, 'sara.db'));
  const c2 = store.listConversations().find((c) => c.title === 'BBQ plans')!;
  assert.equal(store.messages(c2.id)[0].content, 'Smoke the brisket Saturday');
  store.close();
  assert.equal(new Vault(dir2).get('provider:openai'), 'sk-test-secret-value-123', 'vault readable with the restored key');
  assert.equal(JSON.parse(readFileSync(join(dir2, 'settings.json'), 'utf8')).ownerName, 'Alex');
  assert.equal(readFileSync(join(dir2, 'workspaces', 'main', 'proj', 'notes.md'), 'utf8'), '# hi');

  // Backups without workspaces.
  const slim = createBackup(dir2, join(dir2, BACKUPS_DIR, 'slim.tar.gz'), { includeWorkspaces: false });
  assert.equal(slim.includesWorkspaces, false);
  assert.ok(!inspectBackup(join(dir2, BACKUPS_DIR, 'slim.tar.gz')).entries.some((e) => e.path.startsWith('workspaces/')));
});

test('restore refuses unsafe or foreign archives', () => {
  const { dir, cleanup } = tempDir();
  try {
    const manifest = { path: 'sara-backup.json', data: Buffer.from('{"format":"sara-backup","version":1}'), mode: 0o600 };
    const evil = join(dir, 'evil.tar.gz');
    writeFileSync(evil, gzipSync(writeTar([manifest, { path: '../../etc/cron.d/x', data: Buffer.from('boom'), mode: 0o644 }])));
    assert.throws(() => restoreBackup(evil, join(dir, 'data')), /Unsafe path/);
    assert.ok(!existsSync(join(dir, 'data')), 'nothing touched');
    const foreign = join(dir, 'foreign.tar.gz');
    writeFileSync(foreign, gzipSync(writeTar([{ path: 'readme', data: Buffer.from('x'), mode: 0o644 }])));
    assert.throws(() => inspectBackup(foreign), /no sara-backup\.json/);
    writeFileSync(join(dir, 'junk.tar.gz'), 'not gzip');
    assert.throws(() => inspectBackup(join(dir, 'junk.tar.gz')), /decompress/);
    const newer = join(dir, 'newer.tar.gz');
    writeFileSync(newer, gzipSync(writeTar([{ ...manifest, data: Buffer.from('{"format":"sara-backup","version":99}') }])));
    assert.throws(() => inspectBackup(newer), /newer Sara/);
  } finally {
    cleanup();
  }
});

test('automatic backups: once a day, keeps the newest N, manual backups are not pruned', () => {
  const { dir, cleanup } = tempDir();
  try {
    writeFileSync(join(dir, 'settings.json'), '{"providers":[]}');
    const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3));
    const ages: string[] = [];
    for (let d = 1; d <= 5; d++) {
      const name = autoBackupTick(dir, { auto: true, keep: 3 }, day(d), 't');
      assert.ok(name, `day ${d} backs up`);
      // Make file times follow the simulated days.
      utimesSync(join(dir, BACKUPS_DIR, name), day(d), day(d));
      ages.push(name);
      assert.equal(autoBackupTick(dir, { auto: true, keep: 3 }, new Date(day(d).getTime() + 3600_000), 't'), undefined, 'not twice a day');
    }
    createBackup(dir, join(dir, BACKUPS_DIR, 'sara-2026-01-01-00-00-00.tar.gz'));
    autoBackupTick(dir, { auto: true, keep: 3 }, day(6), 't');
    const left = readdirSync(join(dir, BACKUPS_DIR)).sort();
    assert.equal(left.filter((n) => n.endsWith('-auto.tar.gz')).length, 3);
    assert.ok(left.includes('sara-2026-01-01-00-00-00.tar.gz'), 'manual backup kept');
    assert.equal(autoBackupTick(dir, { auto: false, keep: 3 }, day(20), 't'), undefined);
  } finally {
    cleanup();
  }
});

test('health + backup API: checks, create, list, download, delete, settings; owner only', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web'), info: { version: '0.6.1', revision: 'abc1234', startedAt: '2026-10-24T19:00:00Z' } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/status`)).status, 401);
  assert.equal((await fetch(`${base}/backups`)).status, 401);
  const h = await (await fetch(`${base}/status`, { headers: H })).json();
  assert.equal(h.version, '0.6.1');
  assert.equal(h.revision, 'abc1234');
  const byName = Object.fromEntries(h.checks.map((c: { name: string }) => [c.name, c]));
  assert.equal(byName.Model.ok, false, 'no provider yet');
  assert.match(byName.Backups.detail, /first automatic backup/);

  const made = await (await fetch(`${base}/backups`, { method: 'POST', headers: H, body: '{}' })).json();
  assert.match(made.name, /^sara-2026-10-24-20-00-00\.tar\.gz$/);
  assert.equal(made.backups.length, 1);
  const dl = await fetch(`${base}/backups/${made.name}`, { headers: H });
  assert.equal(dl.headers.get('content-type'), 'application/gzip');
  assert.match(dl.headers.get('content-disposition') ?? '', /attachment/);
  const file = join(dir, 'downloaded.tar.gz');
  writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
  assert.ok(inspectBackup(file).entries.some((e) => e.path === 'master.key'));
  assert.equal((await fetch(`${base}/backups/..%2Fmaster.key`, { headers: H })).status, 404, 'only listed backups can be downloaded');
  const put = await (await fetch(`${base}/backups`, { method: 'PUT', headers: H, body: JSON.stringify({ auto: false, keep: 500 }) })).json();
  assert.deepEqual([put.auto, put.keep], [false, 60]);
  const h2 = await (await fetch(`${base}/status`, { headers: H })).json();
  assert.equal(h2.checks.find((c: { name: string }) => c.name === 'Backups').ok, true);
  const del = await (await fetch(`${base}/backups/${made.name}`, { method: 'DELETE', headers: H })).json();
  assert.equal(del.backups.length, 0);
  assert.deepEqual(listBackups(dir), []);
});

test('CLI: --backup writes a file, --restore puts the data back (Sara stopped)', async (t) => {
  const { dir, cleanup } = tempDir();
  const { dir: dir2, cleanup: cleanup2 } = tempDir();
  t.after(() => {
    cleanup();
    cleanup2();
  });
  const store = new Store(join(dir, 'sara.db'));
  store.addMessage(store.createConversation({ title: 'From the CLI' }).id, 'user', 'hello');
  store.close();
  writeFileSync(join(dir, 'settings.json'), '{"providers":[],"ownerName":"Alex"}');
  const node = process.execPath;
  const env = { ...process.env, SARA_DATA: dir, SARA_PORT: '7999' };
  const out = join(dir, 'cli.tar.gz');
  const b = await run(node, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src', 'main.ts'), '--backup', out], { env });
  assert.match(b.stdout, /Backup written: .*cli\.tar\.gz/);
  const r = await run(node, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src', 'main.ts'), '--restore', out], { env: { ...env, SARA_DATA: dir2 } });
  assert.match(r.stdout, /Restored backup from/);
  const s2 = new Store(join(dir2, 'sara.db'));
  const title = s2.listConversations()[0].title;
  s2.close();
  assert.equal(title, 'From the CLI');
});

test('backups skip rebuildable workspace folders and read one file at a time; a restore that fails puts the old data back', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  mkdirSync(join(dir, 'workspaces', 'app', 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(dir, 'workspaces', 'app', 'index.js'), 'console.log(1)');
  writeFileSync(join(dir, 'workspaces', 'app', 'node_modules', 'left-pad', 'index.js'), 'x'.repeat(1000));
  writeFileSync(join(dir, 'settings.json'), '{"ownerName":"Alex"}');
  const out = join(dir, BACKUPS_DIR, 'b.tar.gz');
  createBackup(dir, out);
  const paths = inspectBackup(out).entries.map((e) => e.path);
  assert.ok(paths.includes('workspaces/app/index.js'));
  assert.ok(!paths.some((p) => p.includes('node_modules')), 'node_modules left out');
  // A backup whose files can't all be written (a file where a folder must go): nothing is lost.
  const bad = join(dir, 'bad.tar.gz');
  writeFileSync(bad, gzipSync(writeTar([
    { path: 'sara-backup.json', data: Buffer.from(JSON.stringify({ format: 'sara-backup', version: 1, createdAt: '', saraVersion: 'x', files: 2, includesWorkspaces: true })), mode: 0o600 },
    { path: 'x', data: Buffer.from('file'), mode: 0o600 },
    { path: 'x/y', data: Buffer.from('inside'), mode: 0o600 },
  ])));
  assert.throws(() => restoreBackup(bad, dir), /couldn't finish .* put back\. Nothing was lost/);
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{"ownerName":"Alex"}');
  assert.ok(existsSync(join(dir, 'workspaces', 'app', 'index.js')));
  assert.ok(!readdirSync(dir).some((n) => n.startsWith('before-restore-')), 'no half-restore folder left');
});

test('backup into an empty file someone made for it (sudo sara backup <file>): written in place, no temporary file beside it', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  writeFileSync(join(dir, 'settings.json'), '{}');
  const outDir = join(dir, 'locked');
  mkdirSync(outDir);
  const out = join(outDir, 'b.tar.gz');
  writeFileSync(out, '');
  createBackup(dir, out);
  assert.deepEqual(readdirSync(outDir), ['b.tar.gz']);
  assert.ok(inspectBackup(out).entries.some((e) => e.path === 'settings.json'));
});
