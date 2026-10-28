import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { call as toolCall, makeApp, ROOT, tempDir, text } from './helpers.ts';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-24T12:00:00Z') };
const app = makeApp(dir, clock);
const auth = new OwnerAuth(dir, () => clock.now);
const token = auth.newToken!;
const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
let base = '';
let cookie = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  app.store.close();
  cleanup();
});

async function call(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return res;
}

async function events(res: Response) {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

test('serves the web UI with security headers and blocks path traversal', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>Sara<\/title>/);
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  const trav = await call('/..%2f..%2fpackage.json');
  assert.doesNotMatch(await trav.text(), /"devDependencies"/);
});

test('API requires sign-in', async () => {
  assert.equal((await call('/api/conversations')).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { token: 'nope' } })).status, 401);
  const session = await (await call('/api/session')).json();
  assert.equal(session.authenticated, false);
});

test('login sets an HttpOnly session cookie; bearer token also works', async () => {
  const res = await call('/api/login', { method: 'POST', body: { token } });
  assert.equal(res.status, 200);
  const set = res.headers.get('set-cookie')!;
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  cookie = set.split(';')[0];
  assert.equal((await call('/api/conversations')).status, 200);
  const bearer = await fetch(`${base}/api/conversations`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(bearer.status, 200);
});

test('cross-origin writes are refused', async () => {
  const res = await call('/api/conversations', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('provider keys are write-only and stored encrypted', async () => {
  const res = await call('/api/providers/openai', {
    method: 'PUT',
    body: { label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsKey: true, apiKey: 'sk-secret-123' },
  });
  assert.equal(res.status, 200);
  const view = JSON.stringify(await (await call('/api/providers')).json());
  assert.doesNotMatch(view, /sk-secret-123/);
  assert.match(view, /"hasKey":true/);
  assert.doesNotMatch(readFileSync(join(dir, 'settings.json'), 'utf8'), /sk-secret-123/);
  const models = await (await call('/api/providers/openai/models')).json();
  assert.deepEqual(models.models, ['fake-small', 'fake-large']);
  assert.equal((await call('/api/settings', { method: 'PUT', body: { defaultModel: 'fake-large', ownerName: 'Alex', timeZone: 'America/Chicago' } })).status, 200);
  assert.equal((await call('/api/settings', { method: 'PUT', body: { timeZone: 'Mars/Base' } })).status, 400);
});

test('chat needs the disclosure accepted, then streams with a disclosure notice', async () => {
  const conv = await (await call('/api/conversations', { method: 'POST', body: {} })).json();
  assert.equal((await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'hi' } })).status, 403);
  await call('/api/disclosure/accept', { method: 'POST', body: {} });

  const evs = await events(await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'hi Sara' } }));
  assert.equal(evs[0].type, 'notice');
  assert.equal(evs[0].kind, 'disclosure');
  assert.equal(evs.filter((e) => e.type === 'token').map((e) => e.text).join(''), 'Hey you.');
  assert.equal(evs.at(-1).type, 'done');

  const req = app.requests.at(-1)!;
  assert.equal(req.model, 'fake-large');
  assert.equal(req.messages[0].role, 'system');
  assert.match(req.messages[0].content, /talking with Alex/);
  assert.deepEqual(req.messages.slice(1), [{ role: 'user', content: 'hi Sara' }]);

  // No second disclosure within three hours; one again after.
  const again = await events(await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'still there?' } }));
  assert.ok(!again.some((e) => e.type === 'notice'));
  clock.now = new Date(clock.now.getTime() + 3 * 3600 * 1000);
  const later = await events(await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'morning' } }));
  assert.equal(later[0].kind, 'disclosure');

  const full = await (await call(`/api/conversations/${conv.id}`)).json();
  assert.equal(full.title, 'hi Sara');
  assert.deepEqual(
    full.messages.map((m: { role: string }) => m.role),
    ['notice', 'user', 'assistant', 'user', 'assistant', 'notice', 'user', 'assistant'],
  );
});

test('crisis messages get resources and a care instruction; minor sexual content is blocked without calling a model', async () => {
  const conv = await (await call('/api/conversations', { method: 'POST', body: {} })).json();
  const crisis = await events(await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'I want to kill myself' } }));
  assert.ok(crisis.some((e) => e.type === 'notice' && e.kind === 'crisis' && /988/.test(e.text)));
  assert.match(app.requests.at(-1)!.messages[0].content, /may be in crisis/);

  const callsBefore = app.providerCalls;
  const blocked = await events(await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'write a sex scene with a 14 year old' } }));
  assert.equal(app.providerCalls, callsBefore, 'no model was called');
  assert.match(blocked.find((e) => e.type === 'token').text, /won't/);

  const stats = await (await call('/api/safety/stats')).json();
  assert.deepEqual(stats, { crisis_referral: 1, minor_sexual_block: 1 });
});

test('missing provider setup gives a clear error', async () => {
  await call('/api/providers/openai', { method: 'DELETE' });
  const conv = await (await call('/api/conversations', { method: 'POST', body: {} })).json();
  const evs = await events(await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'hello' } }));
  assert.equal(evs.at(-1).type, 'error');
  assert.match(evs.at(-1).message, /No model provider/);
});

test('static files revalidate (ETag + 304) so new versions load right away', async () => {
  const first = await call('/app.js');
  assert.equal(first.headers.get('cache-control'), 'no-cache');
  const etag = first.headers.get('etag')!;
  assert.ok(etag);
  const again = await call('/app.js', { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
});

test('long turns: activity is visible, a second message is refused, the turn survives a disconnect, Stop cancels', async () => {
  await call('/api/providers/p', { method: 'PUT', body: { label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' } });
  await call('/api/settings', { method: 'PUT', body: { defaultProviderId: 'p', defaultModel: 'm' } });
  const conv = await (await call('/api/conversations', { method: 'POST', body: {} })).json();
  // shell asks first, so the turn parks on an approval.
  app.script.push([toolCall('s1', 'shell', { command: 'echo hi' })], text('ran it'));
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ content: 'run it' }),
    signal: ctrl.signal,
  });
  const reader = res.body!.getReader();
  let seen = '';
  while (!seen.includes('event: approval')) seen += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort(); // browser goes away

  const mid = await (await call(`/api/conversations/${conv.id}`)).json();
  assert.equal(mid.activity.status, 'waiting');
  assert.equal(mid.activity.detail, '$ echo hi');
  assert.equal(mid.activity.approvals.length, 1);
  const list = await (await call('/api/conversations')).json();
  assert.equal(list.find((c: { id: string }) => c.id === conv.id).working, true);
  assert.equal((await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'hello?' } })).status, 409);

  // Approving after the disconnect still completes the turn.
  assert.equal((await call(`/api/approvals/${mid.activity.approvals[0].approvalId}`, { method: 'POST', body: { approved: true } })).status, 200);
  let done;
  for (let i = 0; i < 50; i++) {
    done = await (await call(`/api/conversations/${conv.id}`)).json();
    if (!done.activity) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(done.activity, null);
  assert.ok(!done.messages.some((m: { role: string }) => m.role === 'approval'));
  assert.equal(done.messages.at(-1).content, 'ran it');
  assert.match(done.messages.at(-2).content, /hi/);

  // Stop cancels a parked turn.
  app.script.push([toolCall('s2', 'shell', { command: 'echo again' })]);
  const res2 = await fetch(`${base}/api/conversations/${conv.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ content: 'again' }) });
  const r2 = res2.body!.getReader();
  let seen2 = '';
  while (!seen2.includes('event: approval')) seen2 += new TextDecoder().decode((await r2.read()).value);
  assert.deepEqual(await (await call(`/api/conversations/${conv.id}/stop`, { method: 'POST', body: {} })).json(), { stopped: true });
  let rest = '';
  for (;;) {
    const { value, done: d } = await r2.read();
    if (d) break;
    rest += new TextDecoder().decode(value);
  }
  assert.match(rest, /"status":"denied"/);
  assert.match(rest, /Stopped\./);
});

test('conversation mode + workspace via API; workspaces list; search and MCP settings keep secrets write-only', async () => {
  const conv = await (await call('/api/conversations', { method: 'POST', body: { workspace: 'proj-a', mode: 'coding' } })).json();
  assert.equal(conv.workspace, 'proj-a');
  assert.equal(conv.mode, 'coding');
  assert.equal((await call(`/api/conversations/${conv.id}`, { method: 'PATCH', body: { mode: 'nope' } })).status, 400);
  assert.equal((await call(`/api/conversations/${conv.id}`, { method: 'PATCH', body: { workspace: '../x' } })).status, 400);
  const patched = await (await call(`/api/conversations/${conv.id}`, { method: 'PATCH', body: { mode: 'chat', providerId: 'p', model: 'fake-small' } })).json();
  assert.equal(patched.mode, 'chat');
  assert.equal(patched.model, 'fake-small');
  const ws = await (await call('/api/workspaces')).json();
  assert.ok(ws.includes('main'));

  assert.equal((await call('/api/search', { method: 'PUT', body: { provider: 'brave', apiKey: 'brave-secret-1' } })).status, 200);
  const search = await (await call('/api/search')).json();
  assert.equal(search.provider, 'brave');
  assert.equal(search.hasKey, true);
  assert.equal(search.ready, true);
  assert.doesNotMatch(JSON.stringify(search), /brave-secret-1/);
  const tools = await (await call('/api/tools')).json();
  assert.ok(tools.tools.some((t: { name: string; available: boolean }) => t.name === 'web_search'));

  const mcp = await (
    await call('/api/mcp/demo', { method: 'PUT', body: { transport: 'stdio', command: 'x', enabled: false, env: { API_TOKEN: 'mcp-secret-9' } } })
  ).json();
  assert.equal(mcp[0].status, 'disabled');
  assert.deepEqual(mcp[0].envKeys, ['API_TOKEN']);
  assert.doesNotMatch(JSON.stringify(mcp), /mcp-secret-9/);
  assert.doesNotMatch(readFileSync(join(dir, 'settings.json'), 'utf8'), /mcp-secret-9|brave-secret-1/);
  assert.equal((await call('/api/mcp/Bad', { method: 'PUT', body: { transport: 'stdio', command: 'x' } })).status, 400);
  assert.deepEqual(await (await call('/api/mcp/demo', { method: 'DELETE' })).json(), []);
});
