// Phase 87 (computer use CU1, docs/design/COMPUTER_USE.md §10.2): the hands conformance check.
// Runs CU1's command set against one hands device connected to a Sara server, through the owner's
// test route (POST /api/hands/<id>/op), with a local fixture site (a console error, an HTTP 500, a
// password field, a key-shaped text, a redirect to Sara's own server, a slow page). The same script
// checks the reference hands (--ref), the Windows app and the Mac app.
//
//   node scripts/hands-conformance.ts --server http://127.0.0.1:7881 --token-file <owner token file> [--device <name or id>] [--ref] [--json out.json] [--fixture-port N]
//
// The owner token is read from a file and never printed. Exit code 0 when every check passed.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { CU1_OPS } from '../src/hands.ts';
import { HandsRef } from '../src/hands-ref.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const server = (arg('--server') ?? '').replace(/\/+$/, '');
const tokenFile = arg('--token-file');
if (!server || !tokenFile) {
  console.error('Usage: node scripts/hands-conformance.ts --server http://127.0.0.1:7881 --token-file <owner token file> [--device <name or id>] [--ref] [--json out.json] [--fixture-host <ip the device can reach>] [--fixture-port N]');
  process.exit(2);
}
const owner = readFileSync(tokenFile, 'utf8').trim();
// A fake key built in pieces (never a real one): the device must mask it in what it sends back.
const FAKE_KEY = 'sk-' + 'conformance' + 'Fixture0123456789';
const PASSWORD = 'correct-' + 'horse-battery';

// ---- the fixture site ----
function fixture(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const html = (title: string, body: string) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`);
  };
  if (url.pathname === '/api/data') {
    res.writeHead(500, { 'content-type': 'application/json' });
    return void res.end(JSON.stringify({ error: 'database is down', key: FAKE_KEY }));
  }
  if (url.pathname === '/to-sara') {
    res.writeHead(302, { location: `${server}/` });
    return void res.end();
  }
  if (url.pathname === '/slow') return void setTimeout(() => html('Slow', '<p>late</p>'), 15_000);
  if (url.pathname === '/page2') return html('Second page', '<h1>Second page</h1><p>Page two text.</p>');
  html(
    'Sara hands fixture',
    `<h1>Hello from the fixture</h1>
<p>Status: ready. Key on screen: ${FAKE_KEY}</p>
<form><label>Email <input type="email" name="email" value="alex@example.com"></label>
<label>Password <input type="password" name="pw" value="${PASSWORD}"></label>
<button type="button" id="go">Sign in</button></form>
<a href="/page2">Next page</a>
<script>console.error('Boom: the widget failed to load'); fetch('/api/data').catch(function () {});</script>`,
  );
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, any> }> {
  const r = await fetch(`${server}${path}`, { method, headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
}

async function main(): Promise<number> {
  const fx = createServer(fixture);
  const host = arg('--fixture-host') ?? '127.0.0.1';
  // --fixture-port: a fixed port (e.g. forwarded to another computer with ssh -R).
  await new Promise<void>((r) => fx.listen(Number(arg('--fixture-port') ?? 0), host === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0', r));
  const base = `http://${host}:${(fx.address() as AddressInfo).port}`;
  let ref: HandsRef | undefined;
  let deviceId = '';
  try {
    if (process.argv.includes('--ref')) {
      const pair = await api('POST', '/api/hands/pair', { name: 'Conformance (hands-ref)', token: owner });
      if (pair.status !== 200) throw new Error(`pairing the reference hands failed: HTTP ${pair.status} ${pair.json.error ?? ''}`);
      ref = new HandsRef({ server, token: String(pair.json.token), name: 'Conformance (hands-ref)' });
      await ref.start();
      deviceId = String(pair.json.id);
      await new Promise((r) => setTimeout(r, 300));
    }
    const list = await api('GET', '/api/hands');
    if (list.status !== 200) throw new Error(`GET /api/hands: HTTP ${list.status}`);
    const want = (arg('--device') ?? '').toLowerCase();
    const devices = (list.json.devices ?? []) as Record<string, any>[];
    const dev = deviceId ? devices.find((d) => d.id === deviceId) : devices.find((d) => d.connected && (!want || d.id === want || String(d.label).toLowerCase().includes(want) || String(d.computer ?? '').toLowerCase().includes(want)));
    if (!dev) throw new Error(`no connected hands device${want ? ` matching "${want}"` : ''} (connected: ${devices.filter((d) => d.connected).map((d) => d.label).join(', ') || 'none'})`);
    deviceId = dev.id;
    console.log(`Device: ${dev.label} · ${dev.app} · ${dev.os ?? ''} · browser ${dev.browser?.name ?? '?'}\nFixture: ${base}\n`);
    const op = async (name: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => (await api('POST', `/api/hands/${deviceId}/op`, { op: name, args, ...extra })).json;

    // 1. hello
    check('hello: connected, protocol 1, the CU1 command set, browser opt-in on', dev.connected === true && Array.isArray(dev.ops) && CU1_OPS.every((o) => dev.ops.includes(o)) && dev.optIn?.browser === true, `ops: ${(dev.ops ?? []).join(' ')}`);
    check('hello: nothing beyond CU1 advertised (no click/type/desktop ops)', Array.isArray(dev.ops) && !dev.ops.some((o: string) => /^b\.(click|type|select|keys|scroll|upload|login)|^d\./.test(o)), '');
    const ping = await op('c.ping');
    check('c.ping', ping.ok === true && ping.result?.pong === true);
    const start = await op('b.start');
    check('b.start: the Sara browser runs', start.ok === true, start.ok ? `${start.result?.browser?.name ?? ''}` : start.error?.message);

    // 2. open + logs
    const opened = await op('b.open', { url: `${base}/`, thumb: 320 });
    const r = opened.result ?? {};
    check('b.open: the fixture loads (HTTP 200, its title)', opened.ok === true && r.status === 200 && r.title === 'Sara hands fixture', opened.ok ? `${r.status} ${r.title}` : opened.error?.message);
    check('b.open: counts the console error and the failed request', Number(r.consoleErrors) >= 1 && Number(r.failedRequests) >= 1, `console ${r.consoleErrors}, network ${r.failedRequests}`);
    const thumb = (opened.images ?? []).find((i: any) => i.kind === 'thumb');
    check('b.open: a step thumbnail (JPEG ≤ 320 px wide)', Boolean(thumb) && thumb.mime === 'image/jpeg' && Number(thumb.w) <= 320 && Number(thumb.bytes) > 200, thumb ? `${thumb.w}×${thumb.h}, ${thumb.bytes} bytes` : 'none');
    await new Promise((res) => setTimeout(res, 600));
    const logs = await op('b.logs', {});
    const entries = (logs.result?.entries ?? []) as Record<string, any>[];
    const consoleErr = entries.find((e) => (e.kind === 'console' || e.kind === 'exception') && /Boom: the widget failed/.test(e.text));
    const net500 = entries.find((e) => e.kind === 'network' && e.status === 500 && /\/api\/data/.test(e.url));
    check('b.logs: the console error', Boolean(consoleErr), consoleErr ? consoleErr.text : JSON.stringify(entries).slice(0, 200));
    check('b.logs: the HTTP 500 with method, address and request id', Boolean(net500?.requestId) && net500?.method === 'GET', net500 ? `${net500.method} ${net500.url} → ${net500.status}` : 'missing');
    const since = await op('b.logs', { since: logs.result?.last ?? 0 });
    check('b.logs since: only newer entries', since.ok === true && (since.result?.entries ?? []).length === 0);
    if (net500?.requestId) {
      const body = await op('b.request', { requestId: net500.requestId });
      check('b.request: the response body, text', body.ok === true && /database is down/.test(String(body.result?.body)), String(body.result?.body ?? body.error?.message).slice(0, 80));
      check('b.request: a key-shaped value in it is masked', body.ok === true && !String(body.result?.body).includes(FAKE_KEY));
    } else check('b.request: the response body, text', false, 'no request id');

    // 3. look / read
    const snap = await op('b.snapshot', {});
    const items = (snap.result?.items ?? []) as Record<string, any>[];
    const pw = items.find((i) => i.role === 'password' || i.secret);
    check('b.snapshot: numbered refs with roles (heading, fields, button, link)', snap.ok === true && items[0]?.ref === 'e1' && ['heading', 'button', 'link'].every((role) => items.some((i) => i.role === role)), `${items.length} items`);
    check('b.snapshot: the password field never shows its value', Boolean(pw) && pw!.secret === true && pw!.value === undefined && !JSON.stringify(snap).includes(PASSWORD));
    check('b.snapshot: a viewId and the page size', typeof snap.result?.viewId === 'string' && Number(snap.result?.width) > 0);
    const read = await op('b.read', {});
    const text = String(read.result?.text ?? '');
    check('b.read: the visible text', read.ok === true && /Hello from the fixture/.test(text) && /Status: ready/.test(text), text.slice(0, 60).replace(/\n/g, ' '));
    check('b.read: no password, the key masked', !text.includes(PASSWORD) && !text.includes(FAKE_KEY) && /\[hidden\]/.test(text));
    const one = await op('b.read', { ref: items.find((i) => i.role === 'heading')?.ref ?? 'e1' });
    check('b.read ref: one element', one.ok === true && /Hello from the fixture/.test(String(one.result?.text)));
    const pwRead = pw ? await op('b.read', { ref: pw.ref }) : { ok: true };
    check('b.read of the password field is refused', pwRead.ok === false && !JSON.stringify(pwRead).includes(PASSWORD), pwRead.ok ? 'it answered' : pwRead.error?.code);

    // 4. pictures
    const shot = await op('b.screenshot', { maxWidth: 800, quality: 60 });
    const img = (shot.images ?? [])[0];
    check('b.screenshot: a JPEG at most 800 px wide, with a viewId', shot.ok === true && img?.mime === 'image/jpeg' && Number(img.w) <= 800 && Number(img.bytes) > 500 && typeof shot.result?.viewId === 'string', img ? `${img.w}×${img.h}, ${img.bytes} bytes` : shot.error?.message);
    const frame = await api('GET', `/api/computer/frame/${deviceId}?after=0`);
    check('live view: a frame reached the server (memory only)', typeof frame.json.image === 'string' && frame.json.image.startsWith('data:image/jpeg'), `frame #${frame.json.n}`);

    // 5. tabs and navigation
    const tabs = await op('b.tabs');
    check('b.tabs: lists the fixture tab', tabs.ok === true && (tabs.result?.tabs ?? []).some((t: any) => String(t.url).startsWith(base)));
    const p2 = await op('b.open', { url: `${base}/page2` });
    const back = await op('b.navigate', { action: 'back' });
    check('b.navigate back', p2.ok === true && back.ok === true && back.result?.title === 'Sara hands fixture', back.ok ? back.result?.title : back.error?.message);
    const fwd = await op('b.navigate', { action: 'forward' });
    check('b.navigate forward', fwd.ok === true && fwd.result?.title === 'Second page', fwd.ok ? fwd.result?.title : fwd.error?.message);
    const reload = await op('b.navigate', { action: 'reload' });
    check('b.navigate reload', reload.ok === true);
    const nt = await op('b.open', { url: `${base}/page2`, newTab: true });
    const closed = nt.ok ? await op('b.close', { tab: nt.result?.tab }) : nt;
    check('b.open newTab + b.close', nt.ok === true && closed.ok === true);

    // 6. refused on the device
    for (const [o, a] of [['b.click', { ref: 'e1' }], ['b.type', { ref: 'e2', text: 'x' }], ['d.shot', {}], ['b.evaluate', { expression: '1+1' }]] as [string, Record<string, unknown>][]) {
      const x = await op(o, a);
      check(`refused on the device: ${o} (not in the command set)`, x.ok === false && x.error?.code === 'unsupported', x.ok ? 'it ran' : x.error?.code);
    }
    for (const u of [`${server}/`, `${server}/api/session`, 'file:///C:/Windows/win.ini', 'chrome://settings', 'edge://settings', 'javascript:alert(1)', 'data:text/html,hi', `http://user:pw@127.0.0.1:1/`]) {
      const x = await op('b.open', { url: u });
      check(`refused on the device: open ${u.slice(0, 40)}`, x.ok === false && x.error?.code === 'denied_local', x.ok ? 'it opened' : x.error?.code);
    }
    const mark = (await op('b.logs', {})).result?.last ?? 0;
    const redir = await op('b.open', { url: `${base}/to-sara` });
    const blockedLog = ((await op('b.logs', { since: mark })).result?.entries ?? []).find((e: any) => /blocked/i.test(String(e.error ?? '')) && String(e.url).startsWith(server));
    const loadedSara = redir.ok === true && redir.result?.status === 200 && String(redir.result?.url).startsWith(server);
    check('a redirect to Sara\u2019s own server is blocked by the device', !loadedSara && Boolean(blockedLog), loadedSara ? `loaded ${redir.result?.url}` : blockedLog ? 'blocked (in the logs)' : 'no block in the logs');

    // 7. protocol behaviour
    const fixed = `conf-${Date.now().toString(36)}`;
    const d1 = await op('c.ping', {}, { id: fixed });
    const d2 = await op('c.ping', {}, { id: fixed });
    check('duplicate request id: the same answer', d1.ok === true && JSON.stringify(d1.result) === JSON.stringify(d2.result), `${d1.result?.at} / ${d2.result?.at}`);
    const t0 = Date.now();
    const slow = await op('b.open', { url: `${base}/slow` }, { deadlineMs: 2500 });
    check('deadline: a slow page ends with timeout', slow.ok === false && /timeout|stopped/.test(String(slow.error?.code)) && Date.now() - t0 < 12_000, `${slow.error?.code} after ${Date.now() - t0} ms${slow.ok ? '' : `: ${String(slow.error?.message).slice(0, 80)}`}`);
    const alive = await op('c.ping');
    check('still answering after a timeout', alive.ok === true);
  } catch (err) {
    check('setup', false, (err as Error).message);
  } finally {
    await ref?.stop().catch(() => {});
    if (ref && deviceId) await api('DELETE', `/api/hands/${deviceId}`).catch(() => {});
    fx.close();
  }
  const failed = checks.filter((c) => !c.ok);
  const summary = { device: deviceId, passed: checks.length - failed.length, failed: failed.length, checks };
  console.log(`\n${summary.passed}/${checks.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}`);
  const out = arg('--json');
  if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
  return failed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(err.message);
    process.exit(1);
  },
);
