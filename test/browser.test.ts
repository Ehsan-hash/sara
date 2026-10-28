// Phase 49: the testing browser, against a fake DevTools (CDP) WebSocket server; the network
// guard; screenshots reaching the model and the proof strip; the browser claim check.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { BrowserGuard, PREVIEW_HOST } from '../src/browser-guard.ts';
import { browserAddress, browserArgs, BrowserManager, findBrowser, type BrowserInfo, type LaunchedBrowser } from '../src/browser.ts';
import { buildHistory, runTurn } from '../src/chat.ts';
import { buildSystemPrompt, loadPersona } from '../src/persona.ts';
import { PreviewManager, type PreviewJobs } from '../src/preview.ts';
import { toAnthropic } from '../src/providers/anthropic.ts';
import { toResponsesInput } from '../src/providers/chatgpt.ts';
import { toOpenAIMessages } from '../src/providers/openai-compatible.ts';
import { checkClaims } from '../src/receipts.ts';
import { createBrowserTools, viewportFor } from '../src/tools/browser.ts';
import type { Tool } from '../src/tools/types.ts';
import { acceptWebSocket, connectWebSocket } from '../src/ws.ts';
import { call, makeApp, ROOT, tempDir, text } from './helpers.ts';
import { join } from 'node:path';

const { dir, cleanup } = tempDir();
const clock = { now: new Date('2026-10-26T12:00:00Z') };
const app = makeApp(dir, clock);
after(async () => {
  await app.browsers?.closeAll();
  app.store.close();
  await new Promise((r) => setTimeout(r, 200));
  cleanup();
});

// A 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/** A fake browser: answers DevTools commands and records them. */
async function fakeCdp() {
  const calls: { method: string; params: Record<string, unknown>; sessionId?: string }[] = [];
  let pageTitle = 'Todo app';
  const srv = createServer((_q, s) => s.end());
  srv.on('upgrade', (req, socket, head) => {
    const ws = acceptWebSocket(req, socket, head)!;
    ws.onMessage = (d) => {
      const m = JSON.parse(String(d)) as { id: number; method: string; params: Record<string, unknown>; sessionId?: string };
      calls.push({ method: m.method, params: m.params, ...(m.sessionId ? { sessionId: m.sessionId } : {}) });
      const reply = (result: Record<string, unknown>) => ws.send(JSON.stringify({ id: m.id, result, ...(m.sessionId ? { sessionId: m.sessionId } : {}) }));
      const event = (method: string, params: Record<string, unknown>) => ws.send(JSON.stringify({ method, params, sessionId: 'S1' }));
      switch (m.method) {
        case 'Target.createTarget':
          return reply({ targetId: 'T1' });
        case 'Target.attachToTarget':
          return reply({ sessionId: 'S1' });
        case 'Page.navigate':
          reply({ frameId: 'F1' });
          event('Network.responseReceived', { type: 'Document', response: { status: 200 } });
          event('Runtime.exceptionThrown', { exceptionDetails: { exception: { description: 'TypeError: x is undefined\n at app.js:3' } } });
          return void setTimeout(() => event('Page.loadEventFired', {}), 20);
        case 'Runtime.evaluate': {
          const e = String(m.params.expression);
          if (e.includes('scrollIntoView')) {
            const a = JSON.parse(e.slice(e.lastIndexOf('})(') + 3, -1)) as { field?: boolean; text?: string };
            if (a.text === 'Missing') return reply({ result: { value: { found: false } } });
            return reply({ result: { value: a.field ? { found: true, desc: 'input#new "New task"' } : { found: true, x: 100.5, y: 40, desc: 'button "Add"', covered: '' } } });
          }
          if (e.includes('controls.push')) return reply({ result: { value: { title: pageTitle, url: '/', text: 'Todo\n1 item', more: false, controls: ['button "Add" (#add)'], width: 390, scrollWidth: 412 } } });
          if (e.includes('no_horizontal_scroll')) return reply({ result: { value: [{ ok: true }, { ok: false, detail: 'page 412px wide, window 390px' }] } });
          return reply({ result: { value: { title: pageTitle, url: 'http://sara-preview.test/preview/x/' } } });
        }
        case 'Page.captureScreenshot':
          return reply({ data: PNG });
        case 'Page.getLayoutMetrics':
          return reply({ cssContentSize: { width: 1280, height: 2400 } });
        default:
          return reply({});
      }
    };
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${(srv.address() as AddressInfo).port}/devtools/browser/abc`;
  return { calls, url, close: () => srv.close(), setTitle: (t: string) => (pageTitle = t) };
}

const jobs: PreviewJobs = {
  running: () => [{ id: 7, conversationId: 'c', workspace: 'main', label: 'dev', kind: 'command', status: 'running', exitCode: null, startedAt: '', endedAt: null, tail: '' }],
  pidOf: () => 99,
};

test('our WebSocket client masks its frames and reads the server’s (both ways, large message)', async () => {
  const srv = createServer();
  srv.on('upgrade', (req, socket, head) => {
    const ws = acceptWebSocket(req, socket, head)!; // refuses unmasked client frames
    ws.onMessage = (d) => ws.send(`echo:${String(d).length}`);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const ws = await connectWebSocket(`ws://127.0.0.1:${(srv.address() as AddressInfo).port}/x`);
  const got = new Promise<string>((r) => (ws.onMessage = (d) => r(String(d))));
  ws.send('x'.repeat(70_000));
  assert.equal(await got, 'echo:70000');
  ws.close();
  srv.close();
  await assert.rejects(connectWebSocket('wss://example.com/'), /ws:\/\//);
});

test('open, click, type, read, check and screenshot through the DevTools protocol', async (t) => {
  const cdp = await fakeCdp();
  t.after(async () => {
    await app.browsers?.closeAll();
    cdp.close();
  });
  const killed: string[] = [];
  const launcher = async (): Promise<LaunchedBrowser> => ({ wsUrl: cdp.url, kill: () => killed.push('kill'), exited: Promise.resolve() });
  const previews = new PreviewManager({ owns: async () => true });
  const info: BrowserInfo = { found: true, path: '/fake/chrome', kind: 'chrome', name: 'Fake', how: '' };
  app.previews = previews;
  app.browsers = new BrowserManager({ info: () => info, sandbox: () => app.sandbox, previews, launcher, idleMs: 60_000 });
  app.jobs = jobs as never;
  const conv = app.store.createConversation({ title: 't', mode: 'coding' });
  const tools = new Map(createBrowserTools(app).map((t) => [t.spec.name, t] as const));
  const shown: string[] = [];
  const proof: string[] = [];
  const ctx = { workspaceDir: dir, signal: new AbortController().signal, sandbox: app.sandbox, conversationId: conv.id, showModel: (id: string) => shown.push(id), attachProof: (id: string) => proof.push(id), canSee: true, webAllowed: false };
  const run = (name: string, args: Record<string, unknown>, c: Record<string, unknown> = {}) => tools.get(name)!.run(args, { ...ctx, ...c } as never);

  // Previews first.
  const started = await run('preview_start', { port: 5173 });
  const link = /\/preview\/[0-9a-f]{32}\//.exec(started)![0];
  assert.match(started, /Preview ready/);
  // Opening anything but a preview needs web access.
  await assert.rejects(run('browser_open', { url: 'https://example.com/' }), /Web access is off/);
  await assert.rejects(run('browser_screenshot', {}), /Open a page first/);
  await assert.rejects(run('browser_open', { url: '/preview/0123456789abcdef0123456789abcdef/' }), /ended/);
  const opened = await run('browser_open', { url: `https://sara.example${link}` });
  assert.match(opened, /Opened \/preview\/x\/ \(HTTP 200\)\. Title: Todo app/);
  assert.match(opened, /script error: TypeError: x is undefined/);
  const nav = cdp.calls.find((c) => c.method === 'Page.navigate')!;
  assert.equal(nav.params.url, `http://${PREVIEW_HOST}${link}`);
  assert.equal(nav.sessionId, 'S1');

  const clicked = await run('browser_click', { text: 'Add' });
  assert.match(clicked, /Clicked button "Add"/);
  const mouse = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').map((c) => `${c.params.type}@${c.params.x},${c.params.y}`);
  assert.deepEqual(mouse, ['mouseMoved@100.5,40', 'mousePressed@100.5,40', 'mouseReleased@100.5,40']);
  await assert.rejects(run('browser_click', { text: 'Missing' }), /Nothing on the page matches/);

  const typed = await run('browser_type', { selector: '#new', text: 'Buy milk', submit: true });
  assert.match(typed, /Typed 8 characters into input#new "New task" and pressed Enter/);
  assert.equal(cdp.calls.find((c) => c.method === 'Input.insertText')!.params.text, 'Buy milk');
  assert.ok(cdp.calls.some((c) => c.method === 'Input.dispatchKeyEvent' && c.params.key === 'Enter'));

  const read = await run('browser_read', {});
  assert.match(read, /1 item/);
  assert.match(read, /button "Add" \(#add\)/);
  assert.match(read, /412px wide in a 390px window/);

  const checked = await run('browser_check', { checks: [{ type: 'text_visible', text: '1 item' }, { type: 'no_horizontal_scroll' }, { type: 'no_errors' }] });
  assert.match(checked, /2 of 3 checks failed/);
  assert.match(checked, /PASS text_visible "1 item"/);
  assert.match(checked, /FAIL no_horizontal_scroll \(page 412px wide/);
  assert.match(checked, /FAIL no_errors \(script error/);
  await assert.rejects(run('browser_check', { checks: [{ type: 'run_js', text: 'alert(1)' }] }), /Unknown check/);
  assert.ok(!tools.has('browser_eval'), 'no free-form JavaScript tool');

  // Phone screenshot: the window becomes 390 wide (mobile); she sees it and it goes on her reply.
  const shot = await run('browser_screenshot', { width: 'phone' });
  assert.match(shot, /phone width \(390×844\)/);
  const metrics = cdp.calls.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride').at(-1)!;
  assert.deepEqual([metrics.params.width, metrics.params.height, metrics.params.mobile], [390, 844, true]);
  assert.equal(shown.length, 1);
  assert.deepEqual(proof, shown);
  assert.ok(app.uploads!.get(shown[0]), 'stored like other message pictures');
  // A model that can't see: no picture for it, an honest note (or the picture model's words).
  const blind = await run('browser_screenshot', { width: 'desktop' }, { canSee: false });
  assert.match(blind, /can't see pictures and no picture model is set/);
  assert.equal(shown.length, 1);
  const described = await run('browser_screenshot', { width: '1024', full_page: true }, { canSee: false, describeImage: async () => 'A todo list with an Add button.' });
  assert.match(described, /picture model described it:\nA todo list with an Add button\./);
  assert.match(described, /1024×2400/);
  assert.equal(proof.length, 3);

  // Closing the turn closes the browser.
  assert.equal(await app.browsers.close(conv.id), true);
  assert.ok(cdp.calls.some((c) => c.method === 'Browser.close'));
  assert.deepEqual(killed, ['kill']);
});

test('viewports, addresses and launch switches', () => {
  assert.deepEqual(viewportFor('phone'), { width: 390, height: 844, mobile: true });
  assert.deepEqual(viewportFor(undefined), { width: 1280, height: 800, mobile: false });
  assert.deepEqual(viewportFor('600px'), { width: 600, height: 844, mobile: true });
  assert.throws(() => viewportFor('5000'));
  assert.deepEqual(browserAddress('/preview/0123456789abcdef0123456789abcdef/a?b=1'), { kind: 'preview', token: '0123456789abcdef0123456789abcdef', address: `http://${PREVIEW_HOST}/preview/0123456789abcdef0123456789abcdef/a?b=1` });
  assert.equal(browserAddress('javascript:alert(1)'), undefined);
  assert.equal(browserAddress('file:///etc/passwd'), undefined);
  const edge = browserArgs({ found: true, kind: 'edge', how: '' }, 'C:\\tmp\\p', 4321);
  for (const f of ['--headless=new', '--inprivate', '--no-first-run', '--disable-sync', '--disable-extensions', '--user-data-dir=C:\\tmp\\p', '--proxy-server=http://127.0.0.1:4321', '--proxy-bypass-list=<-loopback>']) assert.ok(edge.includes(f), f);
  assert.equal(edge.filter((a) => a.startsWith('--disable-features')).length, 1, 'one feature list (a second would replace the first)');
  const shell = browserArgs({ found: true, kind: 'shell', how: '' }, '/workspace', 1, { inSandbox: true });
  assert.ok(shell.includes('--headless') && shell.includes('--no-sandbox') && !shell.includes('--inprivate'));
  // Finding one.
  assert.equal(findBrowser('win32', { 'ProgramFiles(x86)': 'C:\\PF86' }, (p) => p === 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe').kind, 'edge');
  assert.equal(findBrowser('linux', {}, (p) => p === '/opt/sara-browser/chrome-headless-shell-linux64/chrome-headless-shell').kind, 'shell');
  const none = findBrowser('linux', {}, () => false);
  assert.equal(none.found, false);
  assert.match(none.how, /install-browser\.sh/);
  assert.match(findBrowser('darwin', {}, () => false).how, /Chrome, Microsoft Edge or Chromium/);
});

/** Sends one request through the guard as a browser would (absolute-form, or CONNECT). */
function viaGuard(port: number, target: string, method = 'GET'): Promise<number> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path: target, headers: { host: 'x' } });
    req.on('response', (r) => {
      r.resume();
      resolve(r.statusCode ?? 0);
    });
    req.on('connect', (r, s) => {
      s.destroy();
      resolve(r.statusCode ?? 0);
    });
    req.on('error', () => resolve(-1));
    req.end();
  });
}

test('network guard: previews only; no Sara API, no local services, no private addresses; web only when allowed', async () => {
  const sara = createServer((_q, s) => s.end('SARA API'));
  await new Promise<void>((r) => sara.listen(0, '127.0.0.1', r));
  const saraPort = (sara.address() as AddressInfo).port;
  const previewsSeen: string[] = [];
  let web = false;
  const g = new BrowserGuard({
    preview: async (_q, res, raw) => {
      previewsSeen.push(raw);
      res.end('preview');
    },
    webAllowed: () => web,
  });
  const port = await g.listen();
  try {
    assert.equal(await viaGuard(port, `http://${PREVIEW_HOST}/preview/0123456789abcdef0123456789abcdef/x?y=1`), 200);
    assert.deepEqual(previewsSeen, ['/preview/0123456789abcdef0123456789abcdef/x?y=1']);
    assert.equal(await viaGuard(port, `http://${PREVIEW_HOST}/api/session`), 404);
    assert.equal(await viaGuard(port, `http://127.0.0.1:${saraPort}/api/session`), 403);
    assert.equal(await viaGuard(port, 'http://example.com/'), 403, 'web off');
    assert.equal(await viaGuard(port, 'example.com:443', 'CONNECT'), 403, 'web off');
    web = true;
    assert.equal(await viaGuard(port, `http://127.0.0.1:${saraPort}/api/session`), 403, 'loopback is never "the web"');
    assert.equal(await viaGuard(port, 'http://169.254.169.254/latest/meta-data/'), 403);
    assert.equal(await viaGuard(port, 'http://10.0.0.1/'), 403);
    assert.equal(await viaGuard(port, '127.0.0.1:443', 'CONNECT'), 403);
    assert.equal(await viaGuard(port, '[::1]:443', 'CONNECT'), 403);
    assert.equal(await viaGuard(port, 'example.com:22', 'CONNECT'), 403, 'only ports 80 and 443');
    assert.ok(g.refused.length >= 3);
    // A browser that resets a refused CONNECT (Edge does) must never take Sara down.
    for (let i = 0; i < 5; i++) {
      const sock = connect(port, '127.0.0.1');
      sock.on('error', () => {});
      sock.write('CONNECT edge.microsoft.com:443 HTTP/1.1\r\nHost: edge.microsoft.com:443\r\n\r\n');
      sock.resetAndDestroy();
    }
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await viaGuard(port, `http://${PREVIEW_HOST}/preview/0123456789abcdef0123456789abcdef/`), 200, 'still answering');
  } finally {
    g.close();
    sara.close();
  }
});

test('screenshots reach the model next to the tool result, and land on her reply as a proof strip', async () => {
  const shotId = app.uploads!.save(`data:image/png;base64,${PNG}`).id;
  const fake: Tool = {
    defaultPermission: 'auto',
    spec: { name: 'browser_screenshot', description: 'x', parameters: { type: 'object', properties: {} } },
    summarize: () => 'screenshot',
    run: async (_a, ctx) => {
      assert.equal(ctx.canSee, true);
      ctx.showModel!(shotId);
      ctx.attachProof!(shotId);
      return 'Screenshot at phone width.';
    },
  };
  app.tools.add(fake);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x', defaultModel: 'm' }], defaultProviderId: 'p', disclosureAcceptedAt: clock.now.toISOString() });
  const conv = app.store.createConversation({ title: 'shots', mode: 'coding' });
  app.script.push([call('c1', 'browser_screenshot', {})], text('I took a screenshot at phone width; the button fits.'));
  const evs = [];
  for await (const ev of runTurn(app, conv.id, 'check it on a phone')) evs.push(ev);
  assert.ok(evs.some((e) => e.type === 'proof' && e.id === shotId));
  // The second model request carries the picture with the tool result.
  const second = app.requests.at(-1)!;
  const toolMsg = second.messages.find((m) => m.role === 'tool' && m.name === 'browser_screenshot') as { images?: { mime: string }[] };
  assert.equal(toolMsg.images?.[0].mime, 'image/png');
  const final = app.store.messages(conv.id).filter((m) => m.role === 'assistant').at(-1)!;
  assert.deepEqual(final.meta?.proof, [shotId]);
  assert.equal(final.meta?.unverified, undefined, 'backed by the screenshot receipt');
  assert.ok(app.store.imagesInUse().has(shotId), 'kept by the photo clean-up');
  app.tools.remove('browser_screenshot');
});

test('provider formats: tool screenshots follow the tool results (OpenAI, ChatGPT) or sit inside them (Anthropic)', () => {
  const img = { mime: 'image/png', data: PNG };
  const msgs = [
    { role: 'user' as const, content: 'go' },
    { role: 'assistant' as const, content: '', toolCalls: [{ id: 'a', name: 'browser_screenshot', arguments: {} }, { id: 'b', name: 'browser_read', arguments: {} }] },
    { role: 'tool' as const, toolCallId: 'a', name: 'browser_screenshot', content: 'shot', images: [img] },
    { role: 'tool' as const, toolCallId: 'b', name: 'browser_read', content: 'text' },
  ];
  const o = toOpenAIMessages(msgs);
  assert.deepEqual(o.map((m) => m.role), ['user', 'assistant', 'tool', 'tool', 'user']);
  assert.match(JSON.stringify(o.at(-1)), /data:image\/png;base64/);
  const a = toAnthropic(msgs).messages;
  const results = a.at(-1)!.content as { type: string; content?: unknown }[];
  assert.equal(results.length, 2);
  assert.match(JSON.stringify(results[0].content), /"type":"image"/);
  const r = toResponsesInput(msgs).input;
  assert.match(JSON.stringify(r.at(-1)), /input_image/);
  assert.equal((r.at(-2) as { type?: string }).type, 'function_call_output');
  // Only the two newest screenshots are sent again; older ones are named.
  const stored = [1, 2, 3].map((i) => ({ id: i, conversationId: 'c', role: 'tool' as const, content: `shot ${i}`, kind: null, createdAt: '', meta: { toolCallId: `t${i}`, name: 'browser_screenshot', images: ['x.png'] } }));
  const asst = [1, 2, 3].map((i) => ({ id: i * 10, conversationId: 'c', role: 'assistant' as const, content: '', kind: null, createdAt: '', meta: { toolCalls: [{ id: `t${i}`, name: 'browser_screenshot', arguments: {} }] } }));
  const h = buildHistory([asst[0], stored[0], asst[1], stored[1], asst[2], stored[2]] as never, Infinity, () => img).messages.filter((m) => m.role === 'tool') as { images?: unknown[]; content: string }[];
  assert.deepEqual(h.map((m) => Boolean(m.images)), [false, true, true]);
  assert.match(h[0].content, /screenshot taken earlier/);
});

test('claim check: "tested it in the browser" and screenshots need the browser tools in this turn', () => {
  const none = checkClaims('I tested it in the browser and clicked through the whole form. It works.', []);
  assert.equal(none[0]?.kind, 'browser');
  assert.equal(checkClaims('I checked it at phone width and nothing overflows.', [])[0]?.kind, 'browser');
  assert.equal(checkClaims('I took a screenshot of the page.', [])[0]?.kind, 'browser');
  const opened = [{ name: 'browser_open', status: 'ok' as const, args: {}, output: 'Opened' }];
  assert.deepEqual(checkClaims('I tested it in the browser and it works.', opened), []);
  assert.equal(checkClaims('I took a screenshot at phone width.', opened)[0]?.kind, 'browser', 'a screenshot claim needs browser_screenshot');
  assert.deepEqual(checkClaims('I took a screenshot at phone width.', [{ name: 'browser_screenshot', status: 'ok', args: {}, output: '' }]), []);
  assert.deepEqual(checkClaims("I haven't tested it in the browser yet.", []), [], 'negations are fine');
  assert.deepEqual(checkClaims('Earlier I tested it in the browser.', []), [], 'earlier turns are fine');
  const failed = [{ name: 'browser_open', status: 'error' as const, args: {}, output: 'failed' }];
  assert.equal(checkClaims('I opened it in the browser.', failed)[0]?.kind, 'browser', 'a failed run backs nothing');
});

test('her coding instructions: preview and test web work, show the proof, never claim visual checks she did not do', () => {
  const persona = loadPersona(join(ROOT, 'persona', 'sara.json'));
  const p = buildSystemPrompt(persona, { now: clock.now, tools: ['shell', 'start_job', 'preview_start', 'browser_open', 'browser_screenshot'], coding: true });
  assert.match(p, /## Web apps: see it run/);
  assert.match(p, /--base \.\//);
  assert.match(p, /browser_screenshot at "desktop" and at "phone" width/);
  assert.match(p, /Never say you tested, clicked through or looked at something in a browser/);
  const chat = buildSystemPrompt(persona, { now: clock.now, tools: ['preview_start', 'browser_open'], coding: false });
  assert.doesNotMatch(chat, /## Web apps/);
});
