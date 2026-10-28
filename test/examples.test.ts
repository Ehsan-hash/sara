// Phase 54: the add-on examples in examples/ (docs/EXTENDING.md) keep working: a tool, a bridge, a
// character, an MCP server and a starter template; plus the coding benchmark's pure helpers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createWeatherTool, describeCode } from '../examples/tools/weather-tool.ts';
import { LineBridge } from '../examples/bridges/line-bridge.ts';
import { codeFromReply, parseProblems, testProgram } from '../scripts/bench-coding.ts';
import { parseCharacter } from '../src/characterfile.ts';
import { checkGalleryFile } from '../src/gallery.ts';
import { copyStarter, listStarters } from '../src/starters.ts';
import { McpManager } from '../src/tools/mcp.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import { call, makeApp, ROOT, tempDir, text } from './helpers.ts';

const noSandbox = { mode: 'none' as const, network: true, detail: '' };
const ctx = (dir: string) => ({ workspaceDir: dir, signal: new AbortController().signal, sandbox: noSandbox });

test('example tool: weather_now geocodes, reads current conditions, hides when disabled', async (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const urls: string[] = [];
  const fakeFetch = (async (url: string) => {
    urls.push(String(url));
    if (String(url).includes('geocoding')) {
      return Response.json(String(url).includes('Nowhere') ? {} : { results: [{ name: 'Austin', admin1: 'Texas', country: 'United States', latitude: 30.27, longitude: -97.74 }] });
    }
    return Response.json({ current: { time: '2026-10-27T14:00', temperature_2m: 24.1, apparent_temperature: 25, wind_speed_10m: 11.2, weather_code: 2 } });
  }) as typeof fetch;
  let on = true;
  const tool = createWeatherTool({ fetch: fakeFetch, enabled: () => on });
  assert.equal(tool.defaultPermission, 'auto');
  assert.equal(tool.summarize({ place: 'Austin' }), 'weather in Austin');
  const out = await tool.run({ place: 'Austin' }, ctx(dir));
  assert.equal(out, 'Austin, Texas, United States at 2026-10-27T14:00 local time: partly cloudy, 24.1 °C (feels like 25 °C), wind 11.2 km/h. Weather data by Open-Meteo.com');
  assert.match(urls[0], /name=Austin/);
  assert.match(urls[1], /latitude=30\.27&longitude=-97\.74/);
  await assert.rejects(tool.run({ place: 'Nowhere' }, ctx(dir)), /couldn't find a place/);
  await assert.rejects(tool.run({}, ctx(dir)), /Missing required argument "place"/);
  assert.equal(describeCode(95), 'thunderstorm');

  // Registered like any tool: shown to the model only while available and not set to "never".
  const reg = new ToolRegistry([]);
  reg.add(tool);
  assert.deepEqual(reg.enabled(undefined).map((x) => x.spec.name), ['weather_now']);
  assert.equal(reg.enabled({ weather_now: 'never' }).length, 0);
  on = false;
  assert.equal(reg.enabled(undefined).length, 0);
});

test('example bridge: the owner gets the owner chat with tools; others get a partner chat with no tools and their own disclosure', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-27T15:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ providers: [{ id: 'p', label: 'Fake', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }], defaultProviderId: 'p', defaultModel: 'fake-small', ownerName: 'Sam', disclosureAcceptedAt: new Date('2026-10-27T15:00:00Z').toISOString() });
  const sent: { chat: string; text: string }[] = [];
  const bridge = new LineBridge(app, { send: async (chat, t) => void sent.push({ chat, text: t }) }, { channel: 'example', ownerIds: ['u-owner'] });

  app.script.push(text('Hi Sam!'));
  await bridge.receive({ chatId: 'dm-1', userId: 'u-owner', userName: 'Sam', text: 'hey' });
  const ownerConv = app.store.findChannelConversation('example', 'dm-1', 'owner')!;
  assert.equal(ownerConv.partner, null);
  assert.ok(app.requests.at(-1)!.tools?.some((x) => x.name === 'write_file'), 'the owner gets her tools');
  assert.equal(sent.at(-1)!.text, 'Hi Sam!');

  // Someone else is ignored unless the owner allows others.
  const before = sent.length;
  await bridge.receive({ chatId: 'dm-2', userId: 'u-alex', userName: 'Alex', text: 'hello?' });
  assert.equal(sent.length, before);

  const open = new LineBridge(app, { send: async (chat, t) => void sent.push({ chat, text: t }) }, { channel: 'example', ownerIds: ['u-owner'], allowOthers: true });
  app.script.push([call('c1', 'write_file', { path: 'x.txt', content: 'nope' })], text('Nice to meet you, Alex.'));
  await open.receive({ chatId: 'dm-2', userId: 'u-alex', userName: 'Alex', text: 'hello?' });
  const partnerConv = app.store.findChannelConversation('example', 'dm-2:u-alex', 'partner')!;
  assert.equal(partnerConv.partner, 'Alex');
  assert.equal(app.requests.at(-2)!.tools?.length ?? 0, 0, 'no tools for other people');
  const toAlex = sent.filter((s) => s.chat === 'dm-2').map((s) => s.text);
  assert.ok(toAlex[0].startsWith('ℹ️ '), 'their own AI disclosure comes first');
  assert.ok(!existsSync(join(workspaceDir(dir, partnerConv.workspace), 'x.txt')), 'a tool call from a partner chat never runs');
});

test('example character: a valid character file that also passes the gallery checks', () => {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', 'characters', 'ada-pair-programmer.json'), 'utf8')) as unknown;
  const { persona } = parseCharacter(raw);
  assert.equal(persona.name, 'Ada');
  assert.equal(persona.humour, 'silly');
  const g = checkGalleryFile('ada-pair-programmer', raw);
  assert.deepEqual(g.tags, ['coding', 'cheerful', 'punny']);
  // Characters must be adults: the same file with a younger age is refused.
  assert.throws(() => parseCharacter({ ...(raw as object), persona: { ...(raw as { persona: object }).persona, age: 17 } }), /adult/);
});

test('example MCP server: Sara connects over stdio and registers its tools', async (t) => {
  const { dir, cleanup } = tempDir();
  const registry = new ToolRegistry([]);
  const mgr = new McpManager(registry, { dataDir: dir, sandbox: noSandbox, secrets: () => ({}) });
  t.after(async () => {
    mgr.stopAll();
    await new Promise((r) => setTimeout(r, 300));
    cleanup();
  });
  const conn = await mgr.start({ name: 'hello', enabled: true, transport: 'stdio', command: process.execPath, args: [join(ROOT, 'examples', 'mcp', 'hello-mcp-server.mjs')] });
  assert.equal(conn.status, 'ready', conn.error);
  const greet = registry.get('mcp_hello_greet')!;
  assert.equal(greet.defaultPermission, 'auto', 'read-only tools run without asking');
  assert.equal(await greet.run({ name: 'Sam' }, ctx(dir)), 'Hello, Sam!');
  assert.equal(await registry.get('mcp_hello_count_words')!.run({ text: 'one two  three' }, ctx(dir)), '3');
});

test('example starter: listed, copied with the project name, and its own tests pass', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const starters = join(ROOT, 'examples', 'starters');
  assert.deepEqual(listStarters(starters).map((s) => s.name), ['word-counter']);
  const { folder } = copyStarter(workspaceDir(dir, 'main'), 'word-counter', 'My-Counter', starters);
  assert.match(readFileSync(join(folder, 'package.json'), 'utf8'), /"name": "my-counter"/);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test'], { cwd: folder, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('coding benchmark helpers: problem parsing, the hidden test program, code from a reply', () => {
  const p = parseProblems('{"task_id":"X/0","prompt":"def add(a, b):\\n    \\"\\"\\"Add.\\"\\"\\"\\n","entry_point":"add","test":"def check(f):\\n    assert f(1, 2) == 3\\n"}\n\n')[0];
  assert.equal(p.entry_point, 'add');
  assert.equal(testProgram('def add(a, b):\n    return a + b', p), 'def add(a, b):\n    return a + b\n\ndef check(f):\n    assert f(1, 2) == 3\n\n\ncheck(add)\n');
  assert.equal(codeFromReply('Here:\n```python\ndef f():\n    return 1\n```\nDone.'), 'def f():\n    return 1');
  assert.equal(codeFromReply('def f(): pass'), 'def f(): pass');
});
