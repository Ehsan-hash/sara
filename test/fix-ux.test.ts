// Pre-1.0 UX review fixes: bridges reconnect only when their own settings change (H1), "Try a
// line" before a model is connected (M1), usage across companions (M11), slower local models (M8),
// the Windows command environment and port hints (H2), Today in the app's language (H3), voice
// counted as picked only when it can speak (M6).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { fallbackAfterMs, runTurn, type ChatEvent } from '../src/chat.ts';
import { voiceWorks } from '../src/checklist.ts';
import type { Provider, ProviderConfig, StreamEvent } from '../src/providers/types.ts';
import { createSaraServer } from '../src/server.ts';
import { buildToday, clearTodayCache } from '../src/today.ts';
import { portInUseHint, windowsToolEnv } from '../src/tools/sandbox.ts';
import { mergeSummaries, UsageStore } from '../src/usage.ts';
import { call, makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';

function mk(t: { after: (fn: () => void) => void }, now = new Date('2026-10-27T15:00:00Z')): TestApp {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  return app;
}

async function serve(t: { after: (fn: () => void) => void }, app: TestApp) {
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  return (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

/** A bridge stand-in that counts reconnects. */
function fakeBridge() {
  const b = { restarts: 0, status: () => ({ running: false, bot: null, error: null }), restart: async () => void b.restarts++, newLinkCode: () => 'X' };
  return b;
}

test('H1: Discord and Telegram reconnect only when their own settings change', async (t) => {
  const app = mk(t);
  const dc = fakeBridge();
  const tg = fakeBridge();
  app.bridges = { discord: dc, telegram: tg } as unknown as typeof app.bridges;
  const api = await serve(t, app);
  const dcBody = { enabled: false, mirror: true, allowServers: false, ownerUserIds: '', ownerWorkInServers: false, answerName: false, answerEveryone: false, answerBots: false, botAllowList: '', botTurnLimit: 2, botHourlyCap: 20 };
  assert.equal((await api('/bridges/discord', 'PUT', dcBody)).status, 200);
  const first = dc.restarts;
  // The same settings again (an autosave of another page used to send these): no reconnect.
  assert.equal((await api('/bridges/discord', 'PUT', dcBody)).status, 200);
  assert.equal((await api('/bridges/discord', 'PUT', dcBody)).status, 200);
  assert.equal(dc.restarts, first, 'unchanged Discord settings keep the gateway connected');
  // A real change reconnects once.
  await api('/bridges/discord', 'PUT', { ...dcBody, mirror: false });
  assert.equal(dc.restarts, first + 1);

  const tgBody = { enabled: false, mirror: true, allowOthers: false, ownerUserIds: '', ownerWorkInGroups: false, answerName: false, answerEveryone: false };
  await api('/bridges/telegram', 'PUT', tgBody);
  const tgFirst = tg.restarts;
  await api('/bridges/telegram', 'PUT', tgBody);
  assert.equal(tg.restarts, tgFirst, 'unchanged Telegram settings keep polling');
  await api('/bridges/telegram', 'PUT', { ...tgBody, answerName: true });
  assert.equal(tg.restarts, tgFirst + 1);
  // A new token is a change too (the settings object itself stays the same).
  await api('/bridges/telegram', 'PUT', { ...tgBody, answerName: true, token: `123456:${'a'.repeat(35)}` });
  assert.equal(tg.restarts, tgFirst + 2);
  assert.equal(dc.restarts, first + 1, 'Telegram changes never touch Discord');
});

test('M1: "Try a line" before a model is connected answers 409 with a friendly message (no 500, no stack in the log)', async (t) => {
  const app = mk(t);
  const api = await serve(t, app);
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  t.after(() => (console.error = orig));
  const list = (await (await api('/gallery')).json()) as { characters: { id: string }[] };
  const r = await api(`/gallery/${list.characters[0].id}/try`, 'POST', {});
  assert.equal(r.status, 409);
  assert.match(((await r.json()) as { error: string }).error, /Connect a brain first/);
  assert.equal(errors.length, 0, 'nothing is logged as a problem');
});

test('M11: usage totals add up every companion, with a split by companion', () => {
  const cfg = { id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1' } as ProviderConfig;
  const local = { id: 'o', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', local: true } as ProviderConfig;
  const a = new UsageStore(new DatabaseSync(':memory:'));
  const b = new UsageStore(new DatabaseSync(':memory:'));
  a.prices = () => [{ model: 'm', inPerM: 1, outPerM: 2 }];
  b.prices = a.prices;
  a.record(cfg, 'm', { input: 1000, output: 100 }, { purpose: 'chat' });
  a.record(local, 'g', { input: 500, output: 50 }, { purpose: 'memory' });
  b.record(cfg, 'm', { input: 3000, output: 300 }, { purpose: 'chat' });
  const since = '2000-01-01T00:00:00Z';
  const m = mergeSummaries([
    { id: 'main', name: 'Sara', summary: a.summary(since) },
    { id: 'jax', name: 'Jax', summary: b.summary(since) },
  ]);
  assert.equal(m.total.calls, 3);
  assert.equal(m.total.input, 4500);
  assert.equal(m.total.output, 450);
  assert.ok(Math.abs(m.total.usd - (0.0012 + 0.0036)) < 1e-9);
  assert.deepEqual(m.total.billing.sort(), ['api', 'local']);
  const mm = m.byModel.find((x) => x.model === 'm')!;
  assert.equal(mm.calls, 2, 'the same model from two companions is one row');
  assert.equal(m.byPurpose.find((x) => x.purpose === 'chat')!.input, 4000);
  assert.deepEqual(m.byCompanion.map((c) => [c.name, c.calls, c.input]), [['Sara', 2, 1500], ['Jax', 1, 3000]]);
});

test('M8: models on your own computer get longer to start (scaled by prompt size); cloud keeps the setting', (t) => {
  const app = mk(t);
  const local = { config: { local: true, baseUrl: 'http://192.168.1.5:11434/v1' } };
  const loopback = { config: { baseUrl: 'http://127.0.0.1:11434/v1' } };
  const cloud = { config: { baseUrl: 'https://api.openai.com/v1' } };
  assert.equal(fallbackAfterMs(app), 60_000);
  assert.equal(fallbackAfterMs(app, { provider: cloud, promptChars: 400_000 }), 60_000);
  assert.equal(fallbackAfterMs(app, { provider: local, promptChars: 0 }), 180_000);
  assert.equal(fallbackAfterMs(app, { provider: loopback, promptChars: 120_000 }), 210_000, '30k tokens → +30 s');
  assert.equal(fallbackAfterMs(app, { provider: local, promptChars: 4_000_000 }), 300_000, 'never more than 5 minutes');
  app.settings.update({ fallbackAfterSec: 240 });
  assert.equal(fallbackAfterMs(app, { provider: local }), 240_000, "a longer wait the owner chose wins");
});

test('M8: a follow-up step that fails after her visible reply ends the turn quietly', async (t) => {
  const app = mk(t);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm' });
  let n = 0;
  app.providerFactory = (config) =>
    ({
      config,
      listModels: async () => ['m'],
      async *stream(): AsyncIterable<StreamEvent> {
        n++;
        if (n === 1) {
          yield* text('Done! Saved it for you.');
          yield call('c1', 'todo', { action: 'list' });
          return;
        }
        throw new Error('no answer within 60 seconds');
      },
    }) as Provider;
  const conv = app.store.createConversation();
  const evs: ChatEvent[] = [];
  const warn = console.warn;
  console.warn = () => {};
  t.after(() => (console.warn = warn));
  for await (const ev of runTurn(app, conv.id, 'save it')) evs.push(ev);
  assert.ok(!evs.some((e) => e.type === 'error'), JSON.stringify(evs.filter((e) => e.type === 'error')));
  assert.equal(evs.at(-1)?.type, 'done');
  assert.ok(app.store.messages(conv.id).some((m) => m.role === 'assistant' && /Done! Saved it/.test(m.content)));
});

test('H2: Windows commands keep LOCALAPPDATA/APPDATA and skip the WindowsApps python alias; busy ports get a hint', () => {
  const env = windowsToolEnv(
    { PATH: 'C:\\Windows\\system32;C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Python313\\', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', SYSTEMROOT: 'C:\\Windows', SECRET_TOKEN: 'x' },
    'D:\\ws',
    'C:\\node\\node.exe',
  );
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\me\\AppData\\Local');
  assert.equal(env.APPDATA, 'C:\\Users\\me\\AppData\\Roaming');
  assert.equal(env.USERPROFILE, 'D:\\ws');
  assert.doesNotMatch(env.PATH, /WindowsApps/);
  assert.match(env.PATH, /^C:\\node;C:\\Windows\\system32;C:\\Python313\\$/);
  assert.equal(env.SECRET_TOKEN, undefined, 'nothing else from the server environment');

  assert.match(portInUseHint('Error: listen EADDRINUSE: address already in use :::8000'), /port 8000 is already used/);
  assert.match(portInUseHint('PermissionError: [WinError 10013] An attempt was made to access a socket in a way forbidden by its access permissions'), /already used by another program/);
  assert.match(portInUseHint('OSError: [WinError 10048] Only one usage of each socket address'), /another port/);
  assert.equal(portInUseHint('SyntaxError: unexpected token'), '');
});

test('H3: Today sends a greeting key, the owner name and the day, so the app words it in its language', async (t) => {
  clearTodayCache();
  const app = mk(t, new Date('2026-10-27T14:00:00Z'));
  app.settings.update({ ownerName: 'Lex', timeZone: 'America/Chicago' });
  const d = await buildToday(app);
  assert.equal(d.greetingKey, 'morning');
  assert.equal(d.owner, 'Lex');
  assert.equal(d.day, '2026-10-27');
  assert.equal(d.greeting, 'Good morning, Lex', 'older apps still get the English line');
});

test('M6: "Pick her voice" is done only when the chosen voice can really speak', (t) => {
  const app = mk(t);
  assert.equal(voiceWorks(app), false, 'nothing chosen');
  app.settings.update({ voice: { tts: 'off', stt: 'off' } } as never);
  assert.equal(voiceWorks(app), false, 'saved but off');
  app.settings.update({ voice: { tts: 'local', stt: 'local' } } as never);
  assert.equal(voiceWorks(app), false, 'the server voice is not installed');
  app.settings.update({ voice: { tts: 'openai', stt: 'off' } } as never);
  assert.equal(voiceWorks(app), false, 'no key');
  app.vault.set('voice:openai', 'sk-test-0000000000000000');
  assert.equal(voiceWorks(app), true);
});
