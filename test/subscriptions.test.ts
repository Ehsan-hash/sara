// Subscription logins: ChatGPT (Sign in with ChatGPT against a fake OpenAI issuer that signs real
// RS256 ID tokens, then the Responses provider against a fake API), Claude/Grok CLI agent provider
// with a fake `claude` that drives Sara's MCP bridge, and the settings API.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { ChatGptProvider, toResponsesInput } from '../src/providers/chatgpt.ts';
import { CLAUDE_ALIASES, CLAUDE_FALLBACK, CliAgentProvider, claudeModels, liveAgentSessions, pickClaudeModels, toCliPrompt } from '../src/providers/cli-agent.ts';
import type { ChatMessage, StreamEvent } from '../src/providers/types.ts';
import { createSaraServer } from '../src/server.ts';
import { ChatGptAuth } from '../src/subscriptions/chatgpt.ts';
import { findWrapped, stripAnsi, Subscriptions } from '../src/subscriptions/index.ts';
import { Vault } from '../src/vault.ts';
import { listen, makeApp, readBody, ROOT, tempDir } from './helpers.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' };

function idToken(claims: Record<string, unknown>, key = privateKey): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
  const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${c}.${sign('sha256', Buffer.from(`${h}.${c}`), key).toString('base64url')}`;
}

async function fakeOpenAI() {
  const st = { challenge: '', nonce: '', tokenCalls: [] as URLSearchParams[], revoked: [] as string[], responses: [] as Record<string, unknown>[], failNext: '' as string, refreshCount: 0 };
  let base = '';
  const { server, url } = await listen(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const json = (code: number, o: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (path === '/.well-known/openid-configuration') return json(200, { issuer: base, authorization_endpoint: `${base}/api/accounts/authorize`, token_endpoint: `${base}/api/accounts/oauth/token`, jwks_uri: `${base}/jwks.json`, revocation_endpoint: `${base}/revoke` });
    if (path === '/jwks.json') return json(200, { keys: [jwk] });
    if (path === '/api/accounts/oauth/token') {
      const p = new URLSearchParams(await readBody(req));
      st.tokenCalls.push(p);
      if (p.get('grant_type') === 'authorization_code') {
        if (createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') !== st.challenge) return json(400, { error: 'invalid_grant' });
        if (p.get('code') !== 'good-code' || p.get('client_id') !== 'oaiapp_123' || p.get('resource') !== 'https://api.openai.com/v1' || p.get('redirect_uri') !== 'http://127.0.0.1:1455/auth/callback') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'at-1', refresh_token: 'rt-1', id_token: idToken({ iss: base, aud: 'oaiapp_123', sub: 'user-42', email: 'alex@example.com', nonce: st.nonce, exp: Math.floor(Date.now() / 1000) + 3600 }), token_type: 'Bearer', expires_in: 3600, scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke' });
      }
      if (p.get('grant_type') === 'refresh_token') {
        st.refreshCount++;
        if (p.get('refresh_token') !== `rt-${st.refreshCount}`) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: `at-${st.refreshCount + 1}`, refresh_token: `rt-${st.refreshCount + 1}`, expires_in: 3600 });
      }
    }
    if (path === '/revoke') {
      st.revoked.push(new URLSearchParams(await readBody(req)).get('token') ?? '');
      return void res.writeHead(200).end();
    }
    if (path === '/v1/models') return json(200, { models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }, { slug: 'hidden-one', visibility: 'hide' }] });
    if (path === '/v1/responses') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      st.responses.push({ ...body, _auth: req.headers.authorization });
      if (st.failNext) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ type: 'response.failed', response: { error: { code: st.failNext } } })}\n\n`);
        st.failNext = '';
        return;
      }
      const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse({ type: 'response.output_text.delta', delta: 'Hey ' }));
      res.write(sse({ type: 'response.output_text.delta', delta: 'you.' }));
      if ((body.tools as unknown[] | undefined)?.length) res.write(sse({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_9', name: 'get_weather', namespace: 'sara', arguments: '{"city":"KC"}' } }));
      res.end(sse({ type: 'response.completed', response: {} }));
      return;
    }
    json(404, {});
  });
  base = url;
  return { st, url, close: () => server.close() };
}

test('ChatGPT sign-in: registration, PKCE, ID token checks, refresh rotation, sign-out', async (t) => {
  const { dir, cleanup } = tempDir();
  const oa = await fakeOpenAI();
  t.after(() => {
    oa.close();
    cleanup();
  });
  let now = Date.now();
  const vault = new Vault(dir);
  const auth = new ChatGptAuth(vault, { issuer: oa.url, now: () => now });
  const start = async () => {
    const { url } = await auth.start();
    const q = new URL(url).searchParams;
    oa.st.challenge = q.get('code_challenge') ?? '';
    oa.st.nonce = q.get('nonce') ?? '';
    return q;
  };
  const q = await start();
  assert.equal(q.get('client_id'), 'dynamic_agent_client');
  assert.equal(q.get('agent_name_hint'), 'Sara');
  assert.match(q.get('ext_agent_host_id') ?? '', /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(q.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback');
  assert.equal(q.get('resource'), 'https://api.openai.com/v1');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('scope')!.split(' ').includes('chatgpt.tokens.use.direct'));
  const hostId = q.get('ext_agent_host_id');

  // Unknown state, cancelled and replayed attempts are refused.
  await assert.rejects(auth.complete('http://127.0.0.1:1455/auth/callback?code=x&state=nope'), /old or unknown attempt/);
  // A refused first registration keeps the issued client id, so the next try reuses it.
  {
    mkdirSync(join(dir, 'v2'));
    const v2 = new Vault(join(dir, 'v2'));
    const a2 = new ChatGptAuth(v2, { issuer: oa.url, now: () => now });
    const s1 = new URL((await a2.start()).url).searchParams;
    await assert.rejects(a2.complete(`?code=bad-code&state=${s1.get('state')}&client_id=oaiapp_123`), /didn't accept that sign-in \(invalid_grant\)/);
    const s2 = new URL((await a2.start()).url).searchParams;
    assert.equal(s2.get('client_id'), 'oaiapp_123');
    assert.equal(s2.get('agent_name_hint'), null);
    assert.equal(a2.status().signedIn, false);
  }
  const cb = `http://127.0.0.1:1455/auth/callback?code=good-code&scope=chatgpt.tokens.use.direct+email&state=${q.get('state')}&client_id=oaiapp_123`;
  const st = await auth.complete(cb);
  assert.deepEqual(st, { signedIn: true, email: 'alex@example.com', planUsage: true, registered: true, welcomed: false });
  await assert.rejects(auth.complete(cb), /old or unknown attempt/, 'a callback works once');
  assert.ok(!readFileSync(join(dir, 'secrets.enc')).toString('utf8').includes('at-1'), 'tokens stored encrypted');
  assert.equal(await auth.accessToken(), 'at-1');

  // A forged ID token (wrong key) or wrong nonce is rejected.
  const q2 = await start();
  const evil = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const forged = new ChatGptAuth(vault, {
    issuer: oa.url,
    fetch: async (u, init) => {
      const r = await fetch(u, init);
      if (!String(u).endsWith('/oauth/token')) return r;
      const j = (await r.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...j, id_token: idToken({ iss: oa.url, aud: 'oaiapp_123', sub: 'user-42', nonce: oa.st.nonce, exp: 9e9 }, evil) }), { status: r.status });
    },
  });
  void q2;
  const { url: u3 } = await forged.start();
  oa.st.challenge = new URL(u3).searchParams.get('code_challenge')!;
  oa.st.nonce = new URL(u3).searchParams.get('nonce')!;
  await assert.rejects(forged.complete(`?code=good-code&state=${new URL(u3).searchParams.get('state')}`), /signature is not valid/);

  // Refresh near expiry rotates the refresh token; concurrent callers share one refresh.
  now += 58 * 60_000;
  const [a1, a2] = await Promise.all([auth.accessToken(), auth.accessToken()]);
  assert.equal(a1, 'at-2');
  assert.equal(a2, 'at-2');
  assert.equal(oa.st.refreshCount, 1);
  const refresh = oa.st.tokenCalls.at(-1)!;
  assert.equal(refresh.get('client_id'), 'oaiapp_123');
  assert.equal(refresh.get('resource'), 'https://api.openai.com/v1');
  assert.equal(refresh.get('scope'), null);

  // Sign-out revokes the refresh token and keeps the registration for next time.
  assert.deepEqual(await auth.signOut(), { revoked: true });
  assert.deepEqual(oa.st.revoked, ['rt-2']);
  assert.equal(auth.status().signedIn, false);
  await assert.rejects(auth.accessToken(), /Not signed in/);
  const again = new URL((await auth.start()).url).searchParams;
  assert.equal(again.get('client_id'), 'oaiapp_123', 'reuses the issued client id');
  assert.equal(again.get('agent_name_hint'), null);
  assert.equal(again.get('ext_agent_host_id'), hostId, 'stable host id');
  assert.equal(again.get('login_hint'), 'alex@example.com');
});

test('ChatGPT provider: Responses API shape, namespaced tools, streaming, friendly limit errors', async (t) => {
  const { dir, cleanup } = tempDir();
  const oa = await fakeOpenAI();
  t.after(() => {
    oa.close();
    cleanup();
  });
  const auth = new ChatGptAuth(new Vault(dir), { issuer: oa.url });
  const { url } = await auth.start();
  oa.st.challenge = new URL(url).searchParams.get('code_challenge')!;
  oa.st.nonce = new URL(url).searchParams.get('nonce')!;
  await auth.complete(`?code=good-code&state=${new URL(url).searchParams.get('state')}&client_id=oaiapp_123`);
  const p = new ChatGptProvider({ id: 'chatgpt', label: 'ChatGPT', kind: 'chatgpt', baseUrl: 'https://api.openai.com/v1' }, auth, { api: `${oa.url}/v1` });
  assert.deepEqual(await p.listModels(), ['gpt-6.1-sol']);
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are Sara.' },
    { role: 'user', content: 'weather?' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: { city: 'KC' } }] },
    { role: 'tool', toolCallId: 'call_1', name: 'get_weather', content: 'rain' },
    { role: 'system', content: 'Safety note.' },
  ];
  const evs: StreamEvent[] = [];
  for await (const ev of p.stream({ model: 'gpt-6.1-sol', messages, tools: [{ name: 'get_weather', description: 'w', parameters: { type: 'object' } }], temperature: 0.7, maxTokens: 50 })) evs.push(ev);
  assert.deepEqual(evs, [{ type: 'text', text: 'Hey ' }, { type: 'text', text: 'you.' }, { type: 'tool_call', call: { id: 'call_9', name: 'get_weather', arguments: { city: 'KC' } } }]);
  const body = oa.st.responses[0];
  assert.equal(body._auth, 'Bearer at-1');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.instructions, 'You are Sara.');
  assert.ok(!('temperature' in body) && !('max_output_tokens' in body), 'unsupported fields omitted');
  assert.deepEqual((body.tools as { type: string; name: string }[])[0].type, 'namespace');
  assert.deepEqual(body.input, toResponsesInput(messages).input);
  assert.deepEqual((body.input as unknown[]).at(-1), { role: 'developer', content: 'Safety note.' }, 'later system notes become developer messages');
  oa.st.failNext = 'subscription_sharing_usage_limit_exceeded';
  await assert.rejects(async () => {
    for await (const _ of p.stream({ model: 'gpt-6.1-sol', messages })) void _;
  }, /usage limit[\s\S]*chatgpt\.com\/settings\/usage/);
});

test('CLI agent provider (fake claude): prompt shape, token/home env, tool call through the MCP bridge, resume, errors', async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const log = join(dir, 'fake-log.json');
  const rt = { kind: 'claude' as const, bin: process.execPath, binArgs: ['--disable-warning=ExperimentalWarning', join(ROOT, 'test', 'fixtures', 'fake-claude.ts')], home: join(dir, 'agents', 'claude'), tmpDir: join(dir, 'tmp'), env: () => ({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test', FAKE_CLAUDE_LOG: log }), tools: true };
  const p = new CliAgentProvider({ id: 'claude-sub', label: 'Claude', kind: 'claude-code', baseUrl: '' }, rt);
  const run = async (messages: ChatMessage[], tools = [{ name: 'get_weather', description: 'w', parameters: { type: 'object' } }]) => {
    const evs: StreamEvent[] = [];
    for await (const ev of p.stream({ model: 'sonnet', messages, tools })) evs.push(ev);
    return evs;
  };
  const text = (evs: StreamEvent[]) => evs.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');

  const hist: ChatMessage[] = [
    { role: 'system', content: 'You are Sara.' },
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'hello there' },
  ];
  assert.equal(text(await run(hist, [])), 'echo: hello there');
  const seen = JSON.parse(readFileSync(log, 'utf8'));
  assert.equal(seen.token, 'sk-ant-oat01-test');
  assert.equal(seen.home, rt.home);
  assert.match(seen.system, /^You are Sara\.[\s\S]*conversation so far[\s\S]*Owner: earlier question[\s\S]*You: earlier answer/);
  for (const flag of ['-p', '--tools', '--setting-sources', '--strict-mcp-config', '--no-session-persistence']) assert.ok(seen.args.includes(flag), flag);
  assert.equal(seen.args[seen.args.indexOf('--tools') + 1], '', 'built-in tools off');

  // Tool call: the CLI pauses inside the MCP call until Sara sends the result.
  const msgs: ChatMessage[] = [{ role: 'system', content: 'You are Sara.' }, { role: 'user', content: 'please use a tool' }];
  const first = await run(msgs);
  const call = first.find((e) => e.type === 'tool_call') as { call: { id: string; name: string; arguments: Record<string, unknown> } };
  assert.equal(text(first), 'Let me check. ');
  assert.equal(call.call.name, 'get_weather', 'MCP prefix removed');
  assert.deepEqual(call.call.arguments, { city: 'KC' });
  assert.equal(liveAgentSessions(), 1, 'paused, not finished');
  msgs.push({ role: 'assistant', content: 'Let me check. ', toolCalls: [call.call] }, { role: 'tool', toolCallId: call.call.id, name: 'get_weather', content: 'rain, 54F' });
  assert.equal(text(await run(msgs)), 'Tool said: rain, 54F');
  assert.equal(liveAgentSessions(), 0, 'process finished and cleaned up');

  await assert.rejects(run([{ role: 'user', content: 'fail please' }], []), /isn't signed in/);
  const missing = new CliAgentProvider({ id: 'x', label: 'Grok', kind: 'grok-cli', baseUrl: '' }, { ...rt, kind: 'grok', bin: join(dir, 'no-such-grok'), binArgs: [] });
  await assert.rejects(async () => {
    for await (const _ of missing.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })) void _;
  }, /isn't installed on this server/);
});

test('toCliPrompt keeps the last owner message as the prompt and work done this turn after it', () => {
  const r = toCliPrompt([
    { role: 'system', content: 'S' },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'read_file', arguments: {} }] },
    { role: 'tool', toolCallId: 'c', name: 'read_file', content: 'file body' },
  ]);
  assert.match(r.system, /Owner: first[\s\S]*You: a1/);
  assert.doesNotMatch(r.system, /second/);
  assert.match(r.prompt, /^second[\s\S]*\[read_file result\]: file body[\s\S]*Continue from there\.$/);
});

test('subscriptions API: Claude token write-only, adds the provider; ChatGPT start URL; owner only', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  const oa = await fakeOpenAI();
  app.subscriptions = new Subscriptions(app.vault, dir, { agentsDir: join(dir, 'none'), chatgpt: new ChatGptAuth(app.vault, { issuer: oa.url }) });
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    oa.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/subscriptions`)).status, 401);
  const v = await (await fetch(`${base}/subscriptions`, { headers: H })).json();
  assert.equal(v.claude.signedIn, false);
  assert.equal(v.grok.installed, false);
  const wrong = await fetch(`${base}/subscriptions/claude`, { method: 'PUT', headers: H, body: JSON.stringify({ token: 'sk-ant-api03-wrongkind' }) });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /claude setup-token/);
  const tok = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123';
  const ok = await (await fetch(`${base}/subscriptions/claude`, { method: 'PUT', headers: H, body: JSON.stringify({ token: tok }) })).json();
  assert.equal(ok.claude.signedIn, true);
  assert.ok(!JSON.stringify(ok).includes(tok));
  const provs = await (await fetch(`${base}/providers`, { headers: H })).json();
  assert.ok(provs.providers.some((p: { id: string; kind: string }) => p.id === 'claude-sub' && p.kind === 'claude-code'));
  assert.equal(provs.defaultProviderId, 'claude-sub', 'first provider becomes the default');
  assert.ok(!JSON.stringify(provs).includes(tok));
  const s = await (await fetch(`${base}/subscriptions/chatgpt/start`, { method: 'POST', headers: H, body: '{}' })).json();
  assert.match(s.url, /\/api\/accounts\/authorize\?client_id=dynamic_agent_client/);
  const bad = await fetch(`${base}/subscriptions/chatgpt/complete`, { method: 'POST', headers: H, body: JSON.stringify({ url: 'http://127.0.0.1:1455/auth/callback?code=x&state=zzz' }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /old or unknown attempt/);
  const del = await (await fetch(`${base}/subscriptions/claude`, { method: 'DELETE', headers: H })).json();
  assert.equal(del.claude.signedIn, false);
});

test('Claude sign-in link: runs setup-token, finds the wrapped link, types the code, saves the token', async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const vault = new Vault(dir);
  const subs = new Subscriptions(vault, dir, { pty: false, bins: { claude: { bin: process.execPath, args: ['--disable-warning=ExperimentalWarning', join(ROOT, 'test', 'fixtures', 'fake-claude-setup.ts')] } } });
  const login = await subs.startClaudeLogin();
  assert.equal(login.url, 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&state=xyz');
  assert.equal(subs.claudeStatus().signedIn, false);
  const st = await subs.finishClaudeLogin('  good#code ');
  assert.equal(st.signedIn, true);
  assert.equal(vault.get('sub:claude'), 'sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef', 'wrapped token re-joined, next text line not included');
  // A wrong code fails clearly.
  // A refused code is reported at once with Claude's own words (the program stays open waiting).
  await subs.startClaudeLogin();
  const t0 = Date.now();
  await assert.rejects(subs.finishClaudeLogin('bad'), /Claude refused that code \(OAuth error: Request failed with status code 400\)/);
  assert.ok(Date.now() - t0 < 5000, 'no 60-second wait');
  await assert.rejects(new Subscriptions(vault, dir).finishClaudeLogin('x'), /Sign in to Claude/);
});

test('terminal text helpers', () => {
  assert.equal(stripAnsi('a\x1b[1Cb\x1b[32mc\x1b[0m\r\nd'), 'a bc\nd');
  assert.equal(findWrapped('see\nhttps://x.com/a?b=1&c\n=2\nPaste code here', /https:\/\//), 'https://x.com/a?b=1&c=2');
  assert.equal(findWrapped('url: https://x.com/a then more', /https:\/\//), 'https://x.com/a');
});

test('Grok bridge entry is added to its own config once, keeping other settings', async () => {
  const { ensureGrokBridge } = await import('../src/providers/cli-agent.ts');
  const { readFileSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { dir, cleanup } = tempDir();
  try {
    mkdirSync(join(dir, '.grok'));
    writeFileSync(join(dir, '.grok', 'config.toml'), '[marketplace]\nx = true\n');
    ensureGrokBridge(dir, '/node', ['a.ts']);
    ensureGrokBridge(dir, '/node', ['a.ts']);
    ensureGrokBridge(dir, '/node2', ['b.ts']);
    const out = readFileSync(join(dir, '.grok', 'config.toml'), 'utf8');
    assert.equal(out.match(/\[mcp_servers\.sara\]/g)?.length, 1);
    assert.match(out, /\[marketplace\]\nx = true/);
    assert.match(out, /command = "\/node2"\nargs = \["b\.ts"\]/);
  } finally {
    cleanup();
  }
});

test('Grok sign-in token for voice/Imagine: read when fresh, renewed by the Grok program when expiring', async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const vault = new Vault(dir);
  const subs = new Subscriptions(vault, dir, { bins: { grok: { bin: process.execPath, args: ['--disable-warning=ExperimentalWarning', join(ROOT, 'test', 'fixtures', 'fake-grok-refresh.ts')] } } });
  assert.equal(await subs.grokAccessToken(), undefined, 'not signed in');
  const home = join(dir, 'agents', 'grok', '.grok');
  mkdirSync(home, { recursive: true });
  const write = (key: string, expires: Date) => writeFileSync(join(home, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::x': { key, expires_at: expires.toISOString(), refresh_token: 'r' } }));
  write('fresh-token', new Date(Date.now() + 3600_000));
  assert.equal(await subs.grokAccessToken(), 'fresh-token');
  write('old-token', new Date(Date.now() + 60_000));
  assert.equal(await subs.grokAccessToken(), 'renewed-token', 'renewed when under 5 minutes left');
});

test('Claude models: Claude Code\'s short names; the subscription token is never sent anywhere by Sara', async () => {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    calls.push(String(u));
    return new Response('{}');
  }) as typeof fetch;
  try {
    assert.deepEqual(claudeModels(), [...CLAUDE_FALLBACK, ...CLAUDE_ALIASES]);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(calls, []);
});

test('Claude subscription models: read from the installed Claude Code, current versions first', async () => {
  // The names really found in Claude Code 2.1.310 (2026-10-27).
  const found = ['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-sonnet-4-5', 'claude-fable-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-haiku-5-5', 'claude-opus-4-1', 'claude-mythos-5', 'claude-opus-4-5', 'claude-opus-4-0', 'claude-sonnet-4-0', 'claude-haiku-4-5-20251001', 'claude-opus-4-1-20250805', 'claude-opus-4', 'claude-mythos-5-1', 'claude-sonnet-4', 'claude-sonnet-5[1m]', 'claude-sonnet-5-5[1m]', 'claude-opus-5-5[1m]', 'claude-opus-5[1m]', 'claude-opus-4-8[1m]', 'claude-sonnet-3-7', 'claude-haiku-3-5', 'claude-fable-5[1m]', 'claude-opus-4-20250514', 'claude-desktop-3', 'claude-eval-9'];
  const picked = pickClaudeModels(found);
  assert.deepEqual(picked.slice(0, 5), ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'claude-opus-5', 'claude-opus-5[1m]', 'claude-opus-4-8']);
  for (const want of ['claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-6']) assert.ok(picked.includes(want), want);
  for (const old of ['claude-opus-4-20', 'claude-desktop-3', 'claude-eval-9', 'claude-opus-4-1', 'claude-sonnet-3-7', 'claude-haiku-3-5', 'claude-opus-4-6', 'claude-haiku-4-5-20251001']) assert.ok(!picked.includes(old), old);
  // A one-digit minor version, and the name must end there: Claude Code's program holds
  // "claude-haiku-3-5" followed by a stray "5" (read once as "claude-haiku-3-55"). Retired 3.x
  // models are dropped even if the program still names them; current families stay.
  const stray = pickClaudeModels(['\0claude-haiku-3-55\0', 'claude-haiku-3-5",', 'claude-sonnet-3-7', 'claude-haiku-4-5\0', 'claude-opus-4-1x', 'claude-opus-4-8-fast', 'claude-sonnet-4-6\'']);
  assert.ok(!stray.some((m) => /-3-|-3$|-55/.test(m)), stray.join(','));
  assert.ok(!stray.includes('claude-opus-4-1') && !stray.includes('claude-opus-4-8'), 'a name that runs on (4-1x, 4-8-fast) is not that model');
  assert.ok(stray.includes('claude-haiku-4-5') && stray.includes('claude-sonnet-4-6'), stray.join(','));
  // From a program file on disk (names inside binary noise), cached until the file changes.
  const dir = mkdtempSync(join(tmpdir(), 'sara-claude-'));
  const bin = join(dir, 'claude');
  const noise = Buffer.alloc(6_000_000, 0x41);
  writeFileSync(bin, Buffer.concat([noise, Buffer.from('\0claude-opus-7-1\0"claude-sonnet-7"\0claude-opus-6-2[1m]\0claude-opus-6-2\0'), noise]));
  try {
    assert.deepEqual(claudeModels(bin), ['claude-opus-7-1', 'claude-opus-6-2', 'claude-opus-6-2[1m]', 'claude-sonnet-7', ...CLAUDE_ALIASES]);
    assert.deepEqual(claudeModels(join(dir, 'missing')), [...CLAUDE_FALLBACK, ...CLAUDE_ALIASES]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
