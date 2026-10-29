// Phase 68: several Sara servers in one client, each with its own sign-in. The terminal client's
// profile store (and its migration from one server), the MCP bridge picking a saved server by name,
// and the VS Code extension's profile logic. A token only ever goes to the server it came from.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { findProfile, loadConfig, main, migrateConfig, removeProfile, saveConfig, uniqueName, upsertProfile, type Io } from '../clients/cli/sara.ts';
import { chatProfile } from '../src/mcp-bridge.ts';
import { ApnsSender } from '../src/apns.ts';
import { Vault } from '../src/vault.ts';
import { generateKeyPairSync } from 'node:crypto';
import { createServer as createH2 } from 'node:http2';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, tempDir } from './helpers.ts';

/** A tiny stand-in for one Sara server: answers whoami and logout, records the tokens it saw. */
async function fakeSara(companion: string): Promise<{ url: string; seen: string[]; loggedOut: string[]; close: () => void }> {
  const seen: string[] = [];
  const loggedOut: string[] = [];
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    const auth = String(req.headers.authorization ?? '');
    seen.push(auth);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/device/logout') {
      loggedOut.push(auth);
      return res.end('{"ok":true}');
    }
    res.end(JSON.stringify({ companion, device: { label: 'sara-chat on test' }, disclosureAccepted: true }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, seen, loggedOut, close: () => srv.close() };
}

const quietIo = () => {
  const o = { out: '', err: '' };
  const io: Io = { out: (s) => void (o.out += s), err: (s) => void (o.err += s), color: false };
  return { io, o };
};

test('sara-chat: an old single-server config becomes profile #1 with nothing to do', () => {
  const { dir, cleanup } = tempDir();
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ server: 'https://sara.example.com/', token: 'sara_dev.a.b', deviceId: 'd1', conversationId: 'c42' }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.version, 2);
    assert.equal(cfg.active, 's1');
    assert.deepEqual(cfg.servers, [{ id: 's1', name: 'sara.example.com', url: 'https://sara.example.com', token: 'sara_dev.a.b', deviceId: 'd1', conversationId: 'c42' }]);
    // Saving writes the new shape; the old top-level keys are gone.
    saveConfig(cfg, dir);
    const disk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(disk.token, undefined);
    assert.equal(disk.server, undefined);
    assert.equal((disk.servers as unknown[]).length, 1);
    // Empty: nothing to migrate.
    assert.deepEqual(migrateConfig({}), { version: 2, servers: [] });
  } finally {
    cleanup();
  }
});

test('sara-chat: profiles: add, names that stay apart, find by name/address/host:port, remove', () => {
  let cfg = upsertProfile({}, { url: 'http://127.0.0.1:7880', token: 'sara_dev.A' }, new Date('2026-10-28T10:00:00Z'));
  cfg = upsertProfile(cfg, { url: 'http://127.0.0.1:7882', token: 'sara_dev.B' }, new Date('2026-10-28T11:00:00Z'));
  assert.deepEqual(cfg.servers.map((p) => p.id), ['s1', 's2']);
  assert.equal(cfg.active, 's2');
  // Two Saras on one host: same companion name gets the host:port added.
  assert.equal(uniqueName(cfg, 'Sara', 'http://127.0.0.1:7882', 's2'), 'Sara');
  cfg = { ...cfg, servers: cfg.servers.map((p) => ({ ...p, name: p.id === 's1' ? 'Sara' : p.name })) };
  assert.equal(uniqueName(cfg, 'Sara', 'http://127.0.0.1:7882', 's2'), 'Sara (127.0.0.1:7882)');
  assert.equal(findProfile(cfg, 'sara')?.id, 's1');
  assert.equal(findProfile(cfg, 's2')?.id, 's2');
  assert.equal(findProfile(cfg, '127.0.0.1:7882')?.id, 's2');
  assert.equal(findProfile(cfg, 'http://127.0.0.1:7880/')?.id, 's1');
  assert.equal(findProfile(cfg)?.id, 's2', 'no name: the one in use');
  assert.equal(findProfile(cfg, 'http://127.0.0.1:9999'), undefined);
  assert.equal(findProfile(cfg, 'https://evil.example'), undefined);
  // Signing in again to the same address replaces that profile's token (no duplicate).
  const again = upsertProfile(cfg, { url: 'http://127.0.0.1:7880', token: 'sara_dev.A2' });
  assert.equal(again.servers.length, 2);
  assert.equal(again.servers.find((p) => p.id === 's1')!.token, 'sara_dev.A2');
  assert.equal(again.active, 's1');
  // Removing one keeps the other's sign-in; the most recently used other one is now in use.
  const rm = removeProfile(cfg, 's2');
  assert.deepEqual(rm.servers.map((p) => [p.id, p.token]), [['s1', 'sara_dev.A']]);
  assert.equal(rm.active, 's1');
  assert.deepEqual(removeProfile(rm, 's1'), { version: 2, servers: [] });
});

test('sara-chat: servers list/use/rename/remove and --server; each token goes only to its own server', async (t) => {
  const { dir, cleanup } = tempDir();
  const home = await fakeSara('Mia');
  const work = await fakeSara('Ava');
  t.after(() => {
    home.close();
    work.close();
    cleanup();
  });
  let cfg = upsertProfile({}, { url: home.url, token: 'sara_dev.home.secret' });
  cfg = upsertProfile(cfg, { url: work.url, token: 'sara_dev.work.secret' });
  saveConfig(cfg, dir);

  let r = quietIo();
  assert.equal(await main(['servers'], r.io, dir), 0);
  assert.match(r.o.out, /^ {2}127\.0\.0\.1:\d+ {2}http:\/\/127\.0\.0\.1:\d+\n\* 127\.0\.0\.1:\d+/m);

  // status on the active one (work) learns her name for the profile.
  r = quietIo();
  assert.equal(await main(['status'], r.io, dir), 0, r.o.err);
  assert.match(r.o.out, /Talking with Ava\. \(1 other server saved/);
  assert.equal(loadConfig(dir).servers.find((p) => p.url === work.url)!.name, 'Ava');
  // --server for one command only: home, by its address; the one in use doesn't change.
  r = quietIo();
  assert.equal(await main(['status', '--server', home.url], r.io, dir), 0, r.o.err);
  assert.match(r.o.out, /Talking with Mia/);
  assert.equal(loadConfig(dir).active, 's2');
  // use by name, without signing anything out.
  r = quietIo();
  assert.equal(await main(['servers', 'use', 'mia'], r.io, dir), 0, r.o.err);
  assert.equal(loadConfig(dir).active, 's1');
  assert.ok(loadConfig(dir).servers.every((p) => p.token));
  // rename sticks over her name.
  r = quietIo();
  assert.equal(await main(['servers', 'rename', 'Mia', 'Home'], r.io, dir), 0);
  await main(['status'], quietIo().io, dir);
  assert.equal(loadConfig(dir).servers.find((p) => p.id === 's1')!.name, 'Home');
  // An unknown --server gets nothing.
  r = quietIo();
  assert.equal(await main(['status', '--server', 'https://evil.example'], r.io, dir), 1);
  assert.match(r.o.err, /No saved server called https:\/\/evil\.example/);

  // Tokens never crossed: home only saw home's token, work only work's.
  assert.ok(home.seen.length > 0 && home.seen.every((a) => a === 'Bearer sara_dev.home.secret'), home.seen.join());
  assert.ok(work.seen.length > 0 && work.seen.every((a) => a === 'Bearer sara_dev.work.secret'), work.seen.join());

  // remove: signs out of that one only.
  r = quietIo();
  assert.equal(await main(['servers', 'remove', 'Ava'], r.io, dir), 0);
  assert.deepEqual(work.loggedOut, ['Bearer sara_dev.work.secret']);
  assert.deepEqual(home.loggedOut, []);
  assert.deepEqual(loadConfig(dir).servers.map((p) => p.name), ['Home']);
  // logout of the last one removes the file.
  assert.equal(await main(['logout'], quietIo().io, dir), 0);
  assert.equal(existsSync(join(dir, 'config.json')), false);
});

test('MCP bridge: --server <name> uses the server saved by sara-chat, with its own token only', async () => {
  const { dir, cleanup } = tempDir();
  try {
    const env = { SARA_CHAT_CONFIG_DIR: dir } as NodeJS.ProcessEnv;
    assert.equal(chatProfile('home', env), undefined, 'no file yet');
    let cfg = upsertProfile({}, { url: 'http://127.0.0.1:7880', token: 'sara_dev.H' });
    cfg = upsertProfile(cfg, { url: 'http://127.0.0.1:7882', token: 'sara_dev.W', name: 'Work' });
    cfg = { ...cfg, servers: cfg.servers.map((p) => (p.id === 's1' ? { ...p, name: 'Home' } : p)) };
    saveConfig(cfg, dir);
    assert.deepEqual(chatProfile('home', env), { url: 'http://127.0.0.1:7880', token: 'sara_dev.H', name: 'Home' });
    assert.deepEqual(chatProfile('Work', env), { url: 'http://127.0.0.1:7882', token: 'sara_dev.W', name: 'Work' });
    assert.equal(chatProfile('127.0.0.1:7882', env)?.token, 'sara_dev.W');
    assert.equal(chatProfile('s1', env)?.token, 'sara_dev.H');
    assert.equal(chatProfile('https://evil.example', env), undefined);
    // The old one-server file works too.
    mkdirSync(join(dir, 'old'));
    writeFileSync(join(dir, 'old', 'config.json'), JSON.stringify({ server: 'https://sara.example.com', token: 'sara_dev.O' }));
    assert.equal(chatProfile('sara.example.com', { SARA_CHAT_CONFIG_DIR: join(dir, 'old') })?.token, 'sara_dev.O');

    // The real bridge process: by name, the key is that server's token (a SARA_API_KEY meant for
    // another server is not sent to it); an unknown name is refused.
    const seen: string[] = [];
    const srv = createServer((req, res) => {
      seen.push(String(req.headers.authorization));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    saveConfig(upsertProfile(loadConfig(dir), { url, token: 'sara_dev.T', name: 'Test' }), dir);
    const bridge = join(ROOT, 'clients', 'mcp', 'sara-mcp.ts');
    const run = (args: string[]) =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const p = spawn(process.execPath, [bridge, ...args], { env: { ...process.env, SARA_CHAT_CONFIG_DIR: dir, SARA_API_KEY: 'sara_dev.someone-else', SARA_URL: '', NODE_TEST_CONTEXT: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (err += d));
        p.stdin.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
        p.on('close', (code) => resolve({ code, out, err }));
      });
    const ok = await run(['--server', 'test']);
    srv.close();
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.err, /using "Test"/);
    assert.deepEqual(seen, ['Bearer sara_dev.T']);
    const bad = await run(['--server', 'nowhere']);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /no server called "nowhere"/);
  } finally {
    cleanup();
  }
});

test('VS Code: profiles: migration of the old sign-in, switching, names, removing; tokens bound to their server', () => {
  const P = createRequire(import.meta.url)(join(ROOT, 'clients', 'vscode', 'profiles.js')) as {
    migrate: (raw: unknown, legacy?: { token: string; server: string }) => { version: 2; active?: string; servers: { id: string; name: string; named?: boolean; url: string; token?: string }[] };
    active: (s: unknown) => { id: string; name: string; url: string; token?: string } | undefined;
    upsert: (s: unknown, add: { url: string; token: string; name?: string }) => ReturnType<typeof P.migrate>;
    use: (s: unknown, id: string) => ReturnType<typeof P.migrate>;
    rename: (s: unknown, id: string, name: string, o?: { herName?: boolean }) => ReturnType<typeof P.migrate>;
    remove: (s: unknown, id: string) => ReturnType<typeof P.migrate>;
    tokenFor: (p: unknown, url: string) => string | undefined;
    statusText: (s: unknown) => { text: string; tooltip: string };
  };
  // The token saved before 1.8 (bound to its server) becomes profile #1.
  let s = P.migrate(undefined, { token: 'sara_dev.old', server: 'https://sara.example.com/' });
  assert.deepEqual(s, { version: 2, active: 's1', servers: [{ id: 's1', name: 'sara.example.com', url: 'https://sara.example.com', token: 'sara_dev.old' }] });
  assert.deepEqual(P.migrate(JSON.stringify(s)), s, 'round trip');
  assert.deepEqual(P.migrate('not json'), { version: 2, servers: [] });
  // Her name names it until the user renames it.
  s = P.rename(s, 's1', 'Mia', { herName: true });
  assert.equal(P.active(s)!.name, 'Mia');
  s = P.upsert(s, { url: 'http://127.0.0.1:7882', token: 'sara_dev.work' });
  assert.equal(P.active(s)!.id, 's2');
  s = P.rename(s, 's2', 'Mia', { herName: true });
  assert.equal(P.active(s)!.name, 'Mia (127.0.0.1:7882)');
  s = P.rename(s, 's2', 'Work');
  s = P.rename(s, 's2', 'Ava', { herName: true });
  assert.equal(P.active(s)!.name, 'Work', 'a name the user chose sticks');
  assert.match(P.statusText(s).text, /Work \$\(chevron-down\)/);
  assert.match(P.statusText(s).tooltip, /Sara on Work \(127\.0\.0\.1:7882\) can use this computer/);
  // Switching keeps both sign-ins.
  s = P.use(s, 's1');
  assert.equal(P.active(s)!.url, 'https://sara.example.com');
  assert.deepEqual(s.servers.map((p) => p.token), ['sara_dev.old', 'sara_dev.work']);
  // A profile's token goes only to its own address.
  const home = s.servers[0];
  assert.equal(P.tokenFor(home, 'https://sara.example.com'), 'sara_dev.old');
  for (const other of ['http://127.0.0.1:7882', 'https://sara.example.com:8443', 'http://sara.example.com', 'https://sara.example.com.evil.example']) assert.equal(P.tokenFor(home, other), undefined, other);
  // Remove forgets only that one.
  s = P.remove(s, 's1');
  assert.deepEqual(s.servers.map((p) => p.id), ['s2']);
  assert.equal(s.active, 's2');
  assert.match(P.statusText(P.remove(s, 's2')).text, /sign in/);
});

test('VS Code: the switcher commands are declared', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'clients', 'vscode', 'package.json'), 'utf8')) as { contributes: { commands: { command: string; title: string }[] } };
  const titles = Object.fromEntries(pkg.contributes.commands.map((c) => [c.command, c.title]));
  assert.equal(titles['sara.switchServer'], 'Sara: Switch server');
  assert.equal(titles['sara.addServer'], 'Sara: Add a server');
});

test('iPhone pushes carry the app\'s own id for that server, so a tap opens the right Sara (old apps unchanged)', async (t) => {
  const { dir, cleanup } = tempDir();
  const bodies = new Map<string, string>();
  const apple = createH2((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      bodies.set(String(req.headers[':path']).split('/').pop()!, b);
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((r) => apple.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(apple.address() as AddressInfo).port}`;
  const db = new DatabaseSync(':memory:');
  const sender = new ApnsSender(db, new Vault(dir), { origin: () => origin });
  t.after(() => {
    sender.close();
    apple.close();
    cleanup();
  });
  const p8 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  sender.setKey({ keyId: 'kid1234567', teamId: 'team123456', bundleId: 'com.backstagecoding.sara', p8 });
  sender.register('a'.repeat(64), true, 'New app', undefined, 's2');
  sender.register('b'.repeat(64), true, 'Old app');
  sender.register('c'.repeat(64), true, 'Odd tag', undefined, '<script>');
  assert.deepEqual(await sender.sendAll({ title: 'Ava', body: 'Hi', url: '/#c=x1' }), { sent: 3, failed: 0, removed: 0 });
  assert.equal(JSON.parse(bodies.get('a'.repeat(64))!).profile, 's2');
  assert.equal(JSON.parse(bodies.get('b'.repeat(64))!).profile, undefined);
  assert.equal(JSON.parse(bodies.get('c'.repeat(64))!).profile, undefined, 'only short plain ids are kept');
  assert.equal(JSON.parse(bodies.get('a'.repeat(64))!).conversationId, 'x1');
});
