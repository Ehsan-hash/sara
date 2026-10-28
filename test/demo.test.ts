// Phase 16: the demo server (SARA_DEMO=1) for app review and trying Sara out.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { ReportStore } from '../src/reports.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir, text } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-24T12:00:00Z') };
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web'), demo: true });
let base = '';
before(async () => {
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});

async function visitor() {
  const r = await fetch(`${base}/api/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return (path: string, opts: { method?: string; body?: unknown } = {}) =>
    fetch(base + path, { method: opts.method ?? 'GET', headers: { cookie, origin: base, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

test('demo: try it without a token; each visitor accepts the disclosure and sees only their own chats; nothing is saved', async () => {
  const s0 = await (await fetch(`${base}/api/session`)).json();
  assert.equal(s0.demo, true);
  const a = await visitor();
  const b = await visitor();
  assert.equal((await (await a('/api/session')).json()).disclosureAccepted, false);
  const conv = await (await a('/api/conversations', { method: 'POST', body: {} })).json();
  assert.equal(conv.offRecord, true);
  assert.equal((await a(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'hi' } })).status, 403, 'disclosure first');
  await a('/api/disclosure/accept', { method: 'POST', body: {} });
  app.script.push(text('Hi! Nice to meet you.'));
  assert.match(await (await a(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'hi, my name is Alex' } })).text(), /Nice to meet you/);
  // Another visitor can't see it, and still has to accept the disclosure.
  assert.deepEqual(await (await b('/api/conversations')).json(), []);
  assert.equal((await b(`/api/conversations/${conv.id}`)).status, 404);
  assert.equal((await (await b('/api/session')).json()).disclosureAccepted, false);
  assert.equal(app.settings.get().disclosureAcceptedAt, undefined, 'the server-wide disclosure is untouched');
  // Nothing reached the database.
  assert.doesNotMatch(JSON.stringify(app.store.db.prepare('SELECT * FROM messages').all()), /Alex/);
  // Adult mode is off: the non-explicit note is in her prompt.
  assert.match(String(app.requests.at(-1)!.messages[0].content), /Adult mode is off/);
});

test('demo: settings and other server changes are refused; daily limit per visitor', async () => {
  const a = await visitor();
  for (const [path, body] of [['/api/settings', { ownerName: 'X' }], ['/api/adult', { on: true, confirm18: true }], ['/api/persona', { name: 'X' }], ['/api/pair', {}], ['/api/github', { token: 'x' }]] as const) {
    const r = await a(path, { method: path === '/api/pair' ? 'POST' : 'PUT', body });
    assert.equal(r.status, 403, path);
  }
  assert.equal((await a('/api/export')).status, 403);
  await a('/api/disclosure/accept', { method: 'POST', body: {} });
  const conv = await (await a('/api/conversations', { method: 'POST', body: {} })).json();
  let last = 0;
  for (let i = 0; i < 41; i++) {
    app.script.push(text('ok'));
    const r = await a(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: `message ${i}` } });
    last = r.status;
    await r.text();
  }
  assert.equal(last, 429);
});

test('demo (security review): owner-only pages are refused to visitors; reports are per visitor; no live calls', async () => {
  app.reports = new ReportStore(app.store.db, app.now);
  const a = await visitor();
  const b = await visitor();
  for (const path of ['/api/backups', '/api/backups/x.tar.gz', '/api/workspaces', '/api/workspaces/main/file?path=a', '/api/doctor', '/api/status', '/api/character/export', '/api/github', '/api/google', '/api/devices', '/api/security', '/api/update', '/api/subscriptions', '/api/push', '/api/mcp', '/api/bridges', '/api/export'])
    assert.equal((await a(path)).status, 403, path);
  for (const path of ['/api/session', '/api/conversations', '/api/tags', '/api/today', '/api/persona']) assert.notEqual((await a(path)).status, 403, path);
  await a('/api/disclosure/accept', { method: 'POST', body: {} });
  const conv = await (await a('/api/conversations', { method: 'POST', body: {} })).json();
  app.script.push(text('An answer.'));
  await (await a(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'hi' } })).text();
  const msg = (await (await a(`/api/conversations/${conv.id}`)).json()).messages.find((m: { role: string }) => m.role === 'assistant');
  assert.equal((await a('/api/reports', { method: 'POST', body: { conversationId: conv.id, messageId: msg.id, reason: 'other', toDeveloper: false } })).status, 201);
  assert.equal((await (await a('/api/reports')).json()).reports.length, 1);
  assert.equal((await (await b('/api/reports')).json()).reports.length, 0, "another visitor's report is not shown");
});
