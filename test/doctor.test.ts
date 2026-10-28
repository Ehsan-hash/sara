// Phase 8: doctor checks.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { runDoctor } from '../src/doctor.ts';
import { Store } from '../src/store.ts';
import { join } from 'node:path';
import { makeApp, tempDir } from './helpers.ts';

test('doctor: database, providers (answering and not), backups, off-server copy', async (t) => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'gemma4:12b' }, { id: 'qwen3.5:9b' }] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  new Store(join(dir, 'sara.db')).close();
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  app.settings.update({
    providers: [
      { id: 'pc', label: 'Ollama on my PC', kind: 'openai-compatible', baseUrl: url },
      { id: 'gone', label: 'Old box', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1' },
    ],
    defaultProviderId: 'pc',
    defaultModel: 'gemma4:12b',
    routes: { background: { providerId: 'pc', model: 'llama9:1b' } },
  });
  const checks = await runDoctor({ dataDir: dir, settings: app.settings, vault: app.vault, providerTimeoutS: 5 });
  const by = (n: string) => checks.find((c) => c.name === n)!;
  assert.equal(by('Database').status, 'ok');
  assert.equal(by('Provider: Ollama on my PC').status, 'warn', 'a route uses a model the provider does not have');
  assert.match(by('Provider: Ollama on my PC').detail, /2 models.*not in its list: llama9:1b/);
  assert.equal(by('Provider: Old box').status, 'warn', 'not the default provider: a warning');
  assert.match(by('Provider: Old box').detail, /Couldn't reach Old box/);
  assert.equal(by('Backups').status, 'warn');
  assert.equal(by('Off-server copy').status, 'warn');
  assert.equal(by('Node.js').status, 'ok');
});
