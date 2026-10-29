// Pre-1.0 hardening (H2, L6): the VS Code extension and the terminal client only ever send their
// saved device token to the server it was issued by.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import Module, { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { main, saveConfig, type Io } from '../clients/cli/sara.ts';
import { ROOT, tempDir } from './helpers.ts';

type Saved = { token: string; server: string } | undefined;
interface Ext {
  parseSaved(raw: string | undefined, legacy?: string): Saved;
  tokenForServer(saved: Saved, server: string): string | undefined;
}

function loadExtension(): Ext {
  const M = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown };
  const orig = M._load;
  M._load = function (req: string, ...rest: unknown[]) {
    if (req === 'vscode') return {};
    return orig.call(this, req, ...rest);
  };
  try {
    return createRequire(import.meta.url)(join(ROOT, 'clients', 'vscode', 'extension.js')) as Ext;
  } finally {
    M._load = orig;
  }
}

test('VS Code: sara.server is application-scoped, untrusted workspaces unsupported; the token is bound to its server', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'clients', 'vscode', 'package.json'), 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { scope?: string }> } };
    capabilities?: { untrustedWorkspaces?: { supported: boolean } };
  };
  assert.equal(pkg.contributes.configuration.properties['sara.server'].scope, 'application');
  assert.equal(pkg.capabilities?.untrustedWorkspaces?.supported, false);
  const ext = loadExtension();
  const saved = ext.parseSaved(JSON.stringify({ token: 'sara_dev.abc', server: 'https://sara.example.com/' }));
  assert.deepEqual(saved, { token: 'sara_dev.abc', server: 'https://sara.example.com' });
  assert.equal(ext.tokenForServer(saved, 'https://sara.example.com'), 'sara_dev.abc');
  assert.equal(ext.tokenForServer(saved, 'sara.example.com'), 'sara_dev.abc');
  for (const other of ['https://evil.example', 'http://sara.example.com', 'https://sara.example.com:8443', 'https://sara.example.com.evil.example', 'https://sara.example.com/other']) {
    assert.equal(ext.tokenForServer(saved, other), undefined, other);
  }
  // An old plain token is bound to the user-level setting only; without one it is never sent.
  assert.deepEqual(ext.parseSaved('sara_dev.old', 'https://home.example'), { token: 'sara_dev.old', server: 'https://home.example' });
  assert.equal(ext.parseSaved('sara_dev.old', undefined), undefined);
  assert.equal(ext.tokenForServer(undefined, 'https://home.example'), undefined);
});

test('terminal client: --server with another address never receives the saved token', async (t) => {
  const { dir, cleanup } = tempDir();
  const seen: (string | undefined)[] = [];
  const evil = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ companion: 'X', device: { label: 'x' } }));
  });
  await new Promise<void>((r) => evil.listen(0, '127.0.0.1', r));
  t.after(() => {
    evil.close();
    cleanup();
  });
  const evilUrl = `http://127.0.0.1:${(evil.address() as AddressInfo).port}`;
  saveConfig({ server: 'https://sara.example.com', token: 'sara_dev.secret-token' }, dir);
  let err = '';
  const io: Io = { out: () => undefined, err: (s: string) => (err += s), color: false } as Io;
  const code = await main(['status', '--server', evilUrl], io, dir);
  assert.equal(code, 1);
  assert.match(err, /No saved server called .*signed in to "sara\.example\.com" \(sara\.example\.com\)/);
  assert.deepEqual(seen, [], 'nothing was sent to the other server');
});
