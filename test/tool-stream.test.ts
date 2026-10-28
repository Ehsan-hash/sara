// Phase 63: tool calls stream while the model writes them (shown only; run once complete).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { runTurn, type ChatEvent } from '../src/chat.ts';
import { AnthropicProvider } from '../src/providers/anthropic.ts';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.ts';
import type { Provider, StreamEvent } from '../src/providers/types.ts';
import { Redactor } from '../src/redact.ts';
import { partialArgs, ToolStreamTracker, type ToolBuilding } from '../src/tool-stream.ts';
import { writeFileTool } from '../src/tools/builtin.ts';
import { listen, makeApp, readBody, tempDir } from './helpers.ts';

test('partialArgs reads half-written JSON as far as it goes', () => {
  assert.deepEqual(partialArgs(''), { values: {} });
  assert.deepEqual(partialArgs('{"pa'), { values: {} });
  assert.deepEqual(partialArgs('{"path": "src/ap'), { values: { path: 'src/ap' }, open: 'path' });
  assert.deepEqual(partialArgs('{"path":"src/app.js","content":"line 1\\nline'), { values: { path: 'src/app.js', content: 'line 1\nline' }, open: 'content' });
  // A half escape at the very end is left out until it is complete.
  assert.deepEqual(partialArgs('{"content":"a\\'), { values: { content: 'a' }, open: 'content' });
  assert.deepEqual(partialArgs('{"content":"\\u00e9\\u00'), { values: { content: 'é' }, open: 'content' });
  assert.deepEqual(partialArgs('{"job": 12, "opts": {"a": [1, "}"]}, "x": "y"}'), { values: { job: '12', opts: '{"a": [1, "}"]}', x: 'y' } });
  assert.deepEqual(partialArgs('{"replace_all": tru'), { values: {} });
  assert.deepEqual(partialArgs('not json'), { values: {} });
  assert.deepEqual(partialArgs('{"q":"say \\"hi\\""}'), { values: { q: 'say "hi"' } });
});

test('tracker: a file write grows live, throttled to ~10 a second, with a line count', () => {
  let now = 0;
  const tr = new ToolStreamTracker({ now: () => now });
  const shown: ToolBuilding[] = [];
  const push = (e: ToolBuilding | undefined) => e && shown.push(e);
  push(tr.add({ index: 0, id: 'c1', name: 'write_file', args: '' }));
  assert.equal(shown.length, 1, 'the first sight of a call shows at once');
  assert.equal(shown[0].kind, 'file');
  assert.equal(shown[0].path, undefined);
  push(tr.add({ index: 0, args: '{"path":"src/ap' }));
  assert.equal(shown.length, 1, 'throttled');
  now = 120;
  push(tr.add({ index: 0, args: 'p.js","content":"const a = 1;\\nconst' }));
  assert.equal(shown.length, 2);
  assert.equal(shown[1].path, 'src/app.js');
  assert.equal(shown[1].preview, 'const a = 1;\nconst');
  assert.equal(shown[1].lines, 2);
  assert.equal(shown[1].id, 'c1');
  for (let i = 0; i < 50; i++) {
    now += 10;
    push(tr.add({ index: 0, args: ' b = 2;\\n' }));
  }
  // 500 ms of pieces every 10 ms: about five events, not fifty.
  assert.ok(shown.length >= 6 && shown.length <= 8, `got ${shown.length}`);
  push(tr.add({ index: 0, args: 'end' }));
  const last = tr.flush();
  assert.equal(last.length, 1, 'the newest state is sent when the stream ends');
  assert.equal(last[0].lines, 52);
  assert.match(last[0].preview, /end$/);
  assert.deepEqual(tr.flush(), [], 'nothing twice');
});

test('tracker: long text is cut to its newest lines; other tools get a short preview; secrets and blocked text stay hidden', () => {
  let now = 0;
  const tr = new ToolStreamTracker({ now: () => (now += 1000), previewChars: 100, redact: (s) => new Redactor(() => ['hunter2-secret']).redact(s), withhold: (s) => /forbidden/.test(s) });
  const big = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\\n');
  const e = tr.add({ index: 0, name: 'write_file', args: `{"path":"notes.txt","content":"${big}` })!;
  assert.equal(e.cut, true);
  assert.ok(e.preview.length <= 100);
  assert.match(e.preview, /^line \d+\n/, 'starts at a whole line');
  assert.match(e.preview, /line 39$/);
  assert.equal(e.lines, 40);
  const sh = tr.add({ index: 1, name: 'shell', args: '{"command":"curl -H token=hunter2-secret http://x' })!;
  assert.equal(sh.kind, 'other');
  assert.doesNotMatch(sh.preview, /hunter2/);
  assert.match(sh.preview, /^curl/);
  const other = tr.add({ index: 2, name: 'remind', args: '{"text":"call mum","when":"tomorrow 9am"}' })!;
  assert.equal(other.preview, 'text: call mum\nwhen: tomorrow 9am');
  const bad = tr.add({ index: 3, name: 'write_file', args: '{"path":"x.md","content":"something forbidden' })!;
  assert.equal(bad.preview, '');
  assert.equal(tr.add({ index: 3, args: ' and more' })!.preview, '', 'stays hidden for the rest of the call');
});

// ---- providers: mocked streams in both formats ----

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const oaTool = (index: number, piece: { id?: string; name?: string; args?: string }) =>
  sse({ choices: [{ delta: { tool_calls: [{ index, ...(piece.id ? { id: piece.id, type: 'function' } : {}), function: { ...(piece.name ? { name: piece.name } : {}), arguments: piece.args ?? '' } }] } }] });
const anDelta = (index: number, partial: string) => sse({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partial } });

const { server, url } = await listen(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || '{}');
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (req.url === '/v1/chat/completions' && body.model === 'parallel') {
    // Two calls written side by side, split mid-word and mid-escape.
    res.write(oaTool(0, { id: 'call_a', name: 'write_file', args: '{"path": "src/in' }));
    res.write(oaTool(1, { id: 'call_b', name: 'write_file', args: '{"path": "READ' }));
    res.write(oaTool(0, { args: 'dex.js", "content": "export const x = 1;\\' }));
    res.write(oaTool(1, { args: 'ME.md", "content": "# Hi' }));
    res.write(oaTool(0, { args: 'n"}' }));
    res.write(oaTool(1, { args: '"}' }));
    res.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
    return res.end('data: [DONE]\n\n');
  }
  if (req.url === '/v1/chat/completions' && body.model === 'cut') {
    res.write(oaTool(0, { id: 'call_c', name: 'write_file', args: '{"path": "a.txt", "content": "half' }));
    return setTimeout(() => res.destroy(), 20);
  }
  if (req.url === '/v1/messages' && body.model === 'parallel') {
    res.write(sse({ type: 'message_start', message: { usage: { input_tokens: 5 } } }));
    res.write(sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_a', name: 'write_file', input: {} } }));
    res.write(anDelta(0, '{"path":"src/main.py","con'));
    res.write(anDelta(0, 'tent":"print(\\"hi\\")\\nprint(2)"}'));
    res.write(sse({ type: 'content_block_stop', index: 0 }));
    res.write(sse({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_b', name: 'shell', input: {} } }));
    res.write(anDelta(1, '{"command": "python src/'));
    res.write(anDelta(1, 'main.py"}'));
    res.write(sse({ type: 'content_block_stop', index: 1 }));
    return res.end(sse({ type: 'message_stop' }));
  }
  if (req.url === '/v1/messages' && body.model === 'cut') {
    res.write(sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_c', name: 'write_file', input: {} } }));
    res.write(anDelta(0, '{"path":"a.txt","content":"half'));
    return setTimeout(() => res.destroy(), 20);
  }
  res.end();
});
after(() => server.close());

async function events(p: Provider, model: string): Promise<{ evs: StreamEvent[]; error?: Error }> {
  const evs: StreamEvent[] = [];
  try {
    for await (const ev of p.stream({ model, messages: [{ role: 'user', content: 'go' }] })) evs.push(ev);
  } catch (err) {
    return { evs, error: err as Error };
  }
  return { evs };
}

/** Feeds a provider's pieces through the tracker (no throttle) and returns the last view of each call. */
function lastViews(evs: StreamEvent[]): Map<number, ToolBuilding> {
  const tr = new ToolStreamTracker({ minIntervalMs: 0 });
  const views = new Map<number, ToolBuilding>();
  for (const ev of evs) if (ev.type === 'tool_delta') {
    const v = tr.add(ev);
    if (v) views.set(v.index, v);
  }
  return views;
}

const oa = new OpenAICompatibleProvider({ id: 'o', label: 'O', kind: 'openai-compatible', baseUrl: `${url}/v1` });
const an = new AnthropicProvider({ id: 'a', label: 'A', kind: 'anthropic', baseUrl: `${url}/v1` }, 'k');

test('OpenAI format: parallel tool calls stream as pieces, then arrive whole', async () => {
  const { evs, error } = await events(oa, 'parallel');
  assert.equal(error, undefined);
  const deltas = evs.filter((e) => e.type === 'tool_delta');
  assert.equal(deltas.length, 6);
  const views = lastViews(evs);
  assert.deepEqual([views.get(0)?.path, views.get(0)?.preview, views.get(0)?.id], ['src/index.js', 'export const x = 1;\n', 'call_a']);
  assert.deepEqual([views.get(1)?.path, views.get(1)?.preview], ['README.md', '# Hi']);
  const calls = evs.filter((e) => e.type === 'tool_call').map((e) => (e as Extract<StreamEvent, { type: 'tool_call' }>).call);
  assert.deepEqual(calls, [
    { id: 'call_a', name: 'write_file', arguments: { path: 'src/index.js', content: 'export const x = 1;\n' } },
    { id: 'call_b', name: 'write_file', arguments: { path: 'README.md', content: '# Hi' } },
  ]);
  // Every piece comes before the finished calls.
  assert.ok(evs.findLastIndex((e) => e.type === 'tool_delta') < evs.findIndex((e) => e.type === 'tool_call'));
});

test('Anthropic format: input_json_delta pieces stream for each tool_use block', async () => {
  const { evs, error } = await events(an, 'parallel');
  assert.equal(error, undefined);
  const views = lastViews(evs);
  assert.deepEqual([views.get(0)?.name, views.get(0)?.path, views.get(0)?.preview, views.get(0)?.lines], ['write_file', 'src/main.py', 'print("hi")\nprint(2)', 2]);
  assert.deepEqual([views.get(1)?.name, views.get(1)?.kind, views.get(1)?.preview], ['shell', 'other', 'python src/main.py']);
  const calls = evs.filter((e) => e.type === 'tool_call');
  assert.equal(calls.length, 2);
});

test('an aborted stream: pieces were shown, no call is produced (both formats)', async () => {
  for (const p of [oa, an]) {
    const { evs, error } = await events(p, 'cut');
    assert.ok(evs.some((e) => e.type === 'tool_delta'), p.config.label);
    assert.equal(evs.filter((e) => e.type === 'tool_call').length, 0, p.config.label);
    // Anthropic simply ends (no message_stop); OpenAI-compatible ends at the cut too: either way nothing to run.
    void error;
  }
});

test('agent loop: live tool cards for a half-written call, and nothing runs when the stream breaks', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T12:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  if (!app.tools.get('write_file')) app.tools.add(writeFileTool);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm' });
  let calls = 0;
  app.providerFactory = (config): Provider => ({
    config,
    listModels: async () => [],
    async *stream(): AsyncIterable<StreamEvent> {
      calls++;
      if (calls === 1) {
        yield { type: 'tool_delta', index: 0, id: 'w1', name: 'write_file', args: '{"path":"big.txt","content":"' };
        yield { type: 'tool_delta', index: 0, args: 'hello\\nworld' };
        throw new Error('connection reset');
      }
      yield { type: 'text', text: 'ok' };
    },
  });
  const conv = app.store.createConversation();
  const evs: ChatEvent[] = [];
  for await (const ev of runTurn(app, conv.id, 'write a big file')) evs.push(ev);
  const live = evs.filter((e) => e.type === 'tool_building') as ToolBuilding[];
  assert.ok(live.length >= 1);
  assert.equal(live[0].name, 'write_file');
  assert.ok(!evs.some((e) => e.type === 'tool_call' || e.type === 'tool_running' || e.type === 'tool_result' || e.type === 'approval'));
  assert.equal(evs.at(-1)?.type, 'error');
  assert.ok(!existsSync(join(dir, 'workspaces', 'main', 'big.txt')), 'a half-written call never runs');
});

test('agent loop: a finished streamed call runs exactly as before', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T12:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  if (!app.tools.get('write_file')) app.tools.add(writeFileTool);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm' });
  const args = '{"path":"hi.txt","content":"one\\ntwo"}';
  app.script.push(
    [
      { type: 'tool_delta', index: 0, id: 'w1', name: 'write_file', args: args.slice(0, 20) },
      { type: 'tool_delta', index: 0, args: args.slice(20) },
      { type: 'tool_call', call: { id: 'w1', name: 'write_file', arguments: JSON.parse(args) } },
    ],
    [{ type: 'text', text: 'Wrote it.' }],
  );
  const conv = app.store.createConversation();
  const evs: ChatEvent[] = [];
  for await (const ev of runTurn(app, conv.id, 'write hi')) evs.push(ev);
  const order = evs.map((e) => e.type).filter((x) => x.startsWith('tool'));
  assert.equal(order[0], 'tool_building');
  assert.ok(order.indexOf('tool_call') > order.lastIndexOf('tool_building'));
  const lastLive = (evs.filter((e) => e.type === 'tool_building') as ToolBuilding[]).at(-1)!;
  assert.deepEqual([lastLive.path, lastLive.preview, lastLive.lines], ['hi.txt', 'one\ntwo', 2]);
  assert.ok(existsSync(join(dir, 'workspaces', 'main', 'hi.txt')));
});
