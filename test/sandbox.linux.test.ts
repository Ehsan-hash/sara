// Phase 2 exit gate item 6: the sandbox "nasty fixture". Linux + bubblewrap only (skipped elsewhere).
// Run on the server: npm run test:sandbox  (see docs/ops/DEPLOYMENT.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { readFileTool } from '../src/tools/builtin.ts';
import { McpManager } from '../src/tools/mcp.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { detectSandbox, runCommand, type SandboxInfo } from '../src/tools/sandbox.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import { ROOT, tempDir } from './helpers.ts';

const usable = process.platform === 'linux' && spawnSync('bwrap', ['--version']).status === 0;
const skip = usable ? false : 'needs Linux with bubblewrap (run on the server)';
const signal = () => new AbortController().signal;

async function sh(cmd: string, ws: string, sb: SandboxInfo): Promise<string> {
  const r = await runCommand(cmd, ws, sb, { timeoutMs: 20_000, signal: signal() });
  return `${r.output}\n[exit ${r.exitCode}]`;
}

function fixture(t: { after: (fn: () => void) => void }) {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  // A fake Sara data dir: secrets next to (not inside) the workspace.
  writeFileSync(join(dir, 'master.key'), 'MASTER-KEY-NASTY-FIXTURE');
  writeFileSync(join(dir, 'secrets.enc'), 'ENCRYPTED-NASTY-FIXTURE');
  const ws = workspaceDir(dir, 'main');
  return { dir, ws };
}

test('nasty fixture: sandbox is active', { skip }, () => {
  assert.equal(detectSandbox('auto').mode, 'bwrap');
});

test('nasty fixture: Sara data next to the workspace is invisible (direct path, ../, symlink)', { skip }, async (t) => {
  const { dir, ws } = fixture(t);
  symlinkSync(join(dir, 'master.key'), join(ws, 'link-to-key'));
  symlinkSync(dir, join(ws, 'link-to-data'));
  const sb = detectSandbox('bwrap', true);
  const out = await sh(`cat ${join(dir, 'master.key')}; cat ../master.key; cat ../../master.key; cat link-to-key; ls link-to-data/; cat link-to-data/secrets.enc; ls /var/lib`, ws, sb);
  assert.doesNotMatch(out, /MASTER-KEY-NASTY-FIXTURE|ENCRYPTED-NASTY-FIXTURE/);
  // File tools refuse the same escapes before anything is read.
  const ctx = { workspaceDir: ws, signal: signal(), sandbox: sb };
  await assert.rejects(readFileTool.run({ path: '../master.key' }, ctx), /outside the workspace/);
  await assert.rejects(readFileTool.run({ path: 'link-to-key' }, ctx), /resolves outside/);
  await assert.rejects(readFileTool.run({ path: 'link-to-data/secrets.enc' }, ctx), /resolves outside/);
});

test('nasty fixture: no env leak (Sara env, provider keys)', { skip }, async (t) => {
  const { ws } = fixture(t);
  const keep = { ...process.env };
  Object.assign(process.env, { SARA_MASTER_KEY: 'NASTY-ENV-1', OPENAI_API_KEY: 'NASTY-ENV-2', ANTHROPIC_API_KEY: 'NASTY-ENV-3' });
  t.after(() => {
    for (const k of ['SARA_MASTER_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) if (keep[k] === undefined) delete process.env[k];
  });
  const out = await sh('env; cat /proc/1/environ 2>/dev/null | tr "\\0" "\\n"', ws, detectSandbox('bwrap', true));
  assert.doesNotMatch(out, /NASTY-ENV|SARA_/);
});

test('nasty fixture: system read-only, /home /root /srv absent, /opt holds only Sara\'s read-only Node, workspace writable', { skip }, async (t) => {
  const { ws } = fixture(t);
  const out = await sh('touch /usr/x 2>&1; touch /etc/x 2>&1; ls -d /home /root /srv 2>&1; echo OPT:$(ls /opt 2>/dev/null | tr "\\n" " "); touch /opt/sara-node/x 2>&1; ls /opt/sara-node/src /opt/sara/src 2>&1; echo hi > w.txt && cat w.txt', ws, detectSandbox('bwrap', true));
  assert.match(out, /\/usr\/x.*Read-only file system/);
  assert.match(out, /\/etc\/x.*Read-only file system/);
  for (const d of ['/home', '/root', '/srv']) assert.match(out, new RegExp(`${d}': No such file or directory`));
  // Only Sara's own Node runtime is visible under /opt (read-only); not her code or anything else.
  assert.match(out, /OPT:(sara-node)? *\n/);
  if (out.includes('OPT:sara-node')) assert.match(out, /\/opt\/sara-node\/x': Read-only file system/);
  assert.match(out, /\/opt\/sara\/src': No such file or directory/);
  assert.match(out, /^hi$/m);
});

test('nasty fixture: network toggle (host loopback reachable only with network on)', { skip }, async (t) => {
  const { ws } = fixture(t);
  const server = createServer((_q, s) => s.end('HOST-SERVICE'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const probe = `curl -s -m 3 http://127.0.0.1:${port}/ || echo NO-NETWORK`;
  assert.match(await sh(probe, ws, detectSandbox('bwrap', true)), /HOST-SERVICE/);
  const off = await sh(probe, ws, detectSandbox('bwrap', false));
  assert.doesNotMatch(off, /HOST-SERVICE/);
  assert.match(off, /NO-NETWORK/);
});

test('nasty fixture: MCP stdio servers get the same jail and only their own secrets', { skip }, async (t) => {
  const { dir } = fixture(t);
  const home = join(dir, 'mcp', 'echo');
  mkdirSync(home, { recursive: true });
  copyFileSync(join(ROOT, 'test', 'fixtures', 'mcp-echo-server.mjs'), join(home, 'echo.mjs'));
  process.env.SARA_MASTER_KEY = 'NASTY-ENV-MCP';
  t.after(() => delete process.env.SARA_MASTER_KEY);
  const registry = new ToolRegistry([]);
  const mgr = new McpManager(registry, { dataDir: dir, sandbox: detectSandbox('bwrap', true), secrets: () => ({ env: { SECRET_TOKEN: 'own-secret' } }) });
  t.after(() => mgr.stopAll());
  const conn = await mgr.start({ name: 'echo', enabled: true, transport: 'stdio', command: process.execPath, args: ['/workspace/echo.mjs'] });
  // process.execPath may live under /opt (private Node); then fall back to the system node.
  const c = conn.status === 'ready' ? conn : await mgr.start({ name: 'echo', enabled: true, transport: 'stdio', command: 'node', args: ['/workspace/echo.mjs'] });
  assert.equal(c.status, 'ready', c.error);
  const out = await registry.get('mcp_echo_echo')!.run({ text: 'x' }, { workspaceDir: dir, signal: signal(), sandbox: detectSandbox('bwrap', true) });
  assert.match(out, /token=own-secret/);
  assert.doesNotMatch(out, /NASTY/);
});
