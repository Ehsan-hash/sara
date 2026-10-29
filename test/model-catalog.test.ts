// Phase 56: always-current model lists. Merging checks (first seen → "New", retired only after two
// good checks, never on an error or an empty list), Ollama Cloud names, the whole cloud catalog
// through an Ollama daemon with pull-before-first-use (fake daemon), removing only retired cloud
// models, picking a replacement, the automatic switch with its notice, and the API routes.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { after, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { resolveProvider } from '../src/chat.ts';
import { healthReport } from '../src/health.ts';
import { catalogIdOf, cloudDaemonName, mergeCheck, ModelCatalog, NEW_FOR_MS, ollamaCloudDefault, parseModel, pickReplacement, prettyModel } from '../src/model-catalog.ts';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.ts';
import type { ChatRequest, Provider, ProviderConfig, StreamEvent } from '../src/providers/types.ts';
import { createSaraServer } from '../src/server.ts';
import { SettingsStore } from '../src/settings.ts';
import { listen, makeApp, ROOT, tempDir } from './helpers.ts';
import { isCloudModelName } from '../src/model-names.ts';

const closers: (() => void)[] = [];
after(() => {
  for (const c of closers.reverse()) c();
});
function scratch() {
  const t = tempDir();
  closers.push(t.cleanup);
  return t.dir;
}

/** A provider whose list the test sets (or makes fail). */
class ListProvider implements Provider {
  readonly config: ProviderConfig;
  readonly lists: Record<string, string[] | Error>;
  constructor(config: ProviderConfig, lists: Record<string, string[] | Error>) {
    this.config = config;
    this.lists = lists;
  }
  async listModels(): Promise<string[]> {
    const l = this.lists[this.config.id];
    if (l instanceof Error) throw l;
    return l ?? [];
  }
  async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    yield { type: 'text', text: `hi from ${req.model}` };
  }
}

function setup(lists: Record<string, string[] | Error>, providers: ProviderConfig[] = [{ id: 'p', label: 'Prov', kind: 'openai-compatible', baseUrl: 'http://p/v1' }]) {
  const dir = scratch();
  const settings = new SettingsStore(dir);
  settings.update({ providers });
  const clock = { now: new Date('2026-10-27T12:00:00Z') };
  const catalog = new ModelCatalog(dir, { settings, providerFor: (c) => new ListProvider(c, lists), now: () => clock.now, fetch: async () => new Response('no', { status: 404 }) });
  return { dir, settings, clock, catalog, lists };
}

test('names: Ollama Cloud catalog ids map to daemon names and back', () => {
  assert.equal(cloudDaemonName('gemma4:31b'), 'gemma4:31b-cloud');
  assert.equal(cloudDaemonName('glm-5.2'), 'glm-5.2:cloud');
  assert.equal(cloudDaemonName('deepseek-v4-pro:0813'), 'deepseek-v4-pro:0813-cloud');
  assert.equal(catalogIdOf('gemma4:31b-cloud'), 'gemma4:31b');
  assert.equal(catalogIdOf('beam:cloud'), 'beam');
  assert.equal(catalogIdOf('mistral-large-3:675b-cloud'), 'mistral-large-3:675b');
  assert.equal(catalogIdOf('gemma4:12b'), undefined, 'a local model has no catalog id');
  assert.ok(isCloudModelName('glm-5.2:cloud') && isCloudModelName('gpt-oss:20b-cloud'));
  assert.ok(!isCloudModelName('qwen3.5:9b') && !isCloudModelName('cloudy:7b'));
  assert.equal(prettyModel('gemma4:31b-cloud'), 'Gemma 4 31B');
  assert.equal(prettyModel('gemma5:31b'), 'Gemma 5 31B');
});

test('merge: models seen at the first check are not new; later ones are, for a week', () => {
  const t0 = new Date('2026-10-01T00:00:00Z');
  const a = mergeCheck(undefined, ['m1', 'm2'], t0);
  assert.equal(a.since, t0.toISOString());
  const t1 = new Date('2026-10-02T00:00:00Z');
  const b = mergeCheck(a, ['m1', 'm2', 'm3'], t1);
  assert.equal(b.models.m1.firstSeen, t0.toISOString(), 'firstSeen is kept');
  assert.equal(b.models.m3.firstSeen, t1.toISOString());
  assert.equal(b.models.m1.lastSeen, t1.toISOString());
});

test('catalog: New badge for a week, retired only after two good checks, never on an error or an empty list', async () => {
  const { catalog, clock, lists } = setup({ p: ['alpha', 'beta', 'nomic-embed-text'] });
  let v = await catalog.refresh('p');
  assert.deepEqual(v.models, ['alpha', 'beta'], 'embedding models are left out of pickers');
  assert.equal(v.hidden, 1);
  assert.ok(!v.entries.some((e) => e.new), 'nothing is "new" on the very first check');

  clock.now = new Date('2026-10-28T12:00:00Z');
  lists.p = ['alpha', 'gamma', 'nomic-embed-text'];
  v = await catalog.refresh('p');
  assert.deepEqual(v.models, ['alpha', 'gamma', 'beta'], 'one missed check hides nothing (in the provider\'s order, the missing one last)');
  assert.deepEqual(v.entries.find((e) => e.id === 'gamma'), { id: 'gamma', new: true });

  // An error and an empty list don't count as checks without "beta".
  clock.now = new Date('2026-10-29T12:00:00Z');
  lists.p = new Error('down');
  v = await catalog.refresh('p');
  assert.match(v.error ?? '', /down/);
  assert.ok(v.models.includes('beta'));
  lists.p = [];
  v = await catalog.refresh('p');
  assert.match(v.error ?? '', /empty/);
  assert.ok(v.models.includes('beta'), 'an empty list retires nothing');
  assert.equal(v.checkedAt, '2026-10-28T12:00:00.000Z', 'failed checks keep the last good time');

  lists.p = ['alpha', 'gamma'];
  v = await catalog.refresh('p');
  assert.ok(!v.models.includes('beta'), 'second good check without it: retired and hidden');
  assert.deepEqual(v.retired, ['beta']);
  assert.ok(catalog.isRetired('p', 'beta'));

  // The badge goes after a week; a retired model that comes back is shown again.
  clock.now = new Date(Date.parse('2026-10-28T12:00:00Z') + NEW_FOR_MS + 1000);
  lists.p = ['alpha', 'beta', 'gamma'];
  v = await catalog.refresh('p');
  assert.ok(!v.entries.some((e) => e.new));
  assert.ok(v.models.includes('beta'));
});

test('catalog: list() checks again only when older than a day; the background tick skips switched-off providers', async () => {
  const { catalog, clock, lists, settings } = setup({ p: ['a1'], q: ['b1'] }, [
    { id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://p/v1' },
    { id: 'q', label: 'Q', kind: 'openai-compatible', baseUrl: 'http://q/v1' },
  ]);
  await catalog.list('p');
  lists.p = ['a1', 'a2'];
  assert.deepEqual((await catalog.list('p')).models, ['a1'], 'fresh enough: the kept list');
  clock.now = new Date(clock.now.getTime() + 25 * 3600_000);
  assert.deepEqual((await catalog.list('p')).models, ['a1', 'a2'], 'a day old: checked again');
  settings.update({ modelLists: { q: { keepCurrent: false } } });
  assert.equal(await catalog.tick(), undefined, 'p is fresh and q is switched off');
  settings.update({ modelLists: {} });
  assert.equal(await catalog.tick(), 'q', 'one provider per step, the oldest first');
  assert.equal(await catalog.tick(), undefined);
});

test('replacement: same family, highest version, same size; else the recommendation for the job', () => {
  assert.equal(pickReplacement('gemma4:31b-cloud', ['gemma5:31b-cloud', 'gemma5:12b-cloud', 'gemma3:31b-cloud', 'glm-5.3:cloud']), 'gemma5:31b-cloud');
  assert.equal(pickReplacement('claude-sonnet-4-5-20250929', ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5']), 'claude-sonnet-4-6');
  assert.equal(pickReplacement('kimi-k2.6:cloud', ['kimi-k3:cloud', 'kimi-k2.7-code:cloud', 'gemma4:12b']), 'kimi-k3:cloud');
  assert.equal(pickReplacement('glm-5.2:cloud', ['glm-5.3:cloud', 'glm-5.3-flash:cloud']), 'glm-5.3:cloud', 'flash is another family');
  // A cloud model is replaced by a cloud one, a local one by a local one, when both exist.
  assert.equal(pickReplacement('gemma4:12b', ['gemma4:31b-cloud', 'gemma4:27b', 'gemma5:12b-cloud']), 'gemma4:27b');
  assert.deepEqual(parseModel('deepseek-v4-pro:0813-cloud'), { family: 'deepseek-v-pro', version: [4, 813] });
  // No family member: the coding recommendation for a coding job, nothing for a lone embedding.
  assert.equal(pickReplacement('oldcoder:7b', ['qwen3-coder:30b', 'gemma4:12b'], 'coding'), 'qwen3-coder:30b');
  assert.equal(pickReplacement('nomic-embed-text', ['gemma4:12b']), undefined);
  assert.equal(pickReplacement('x', []), undefined);
  // Private conversations never move to a cloud model.
  assert.equal(pickReplacement('llama3:8b', ['llama4:8b-cloud'], 'private'), undefined);
});

test('auto-switch: a retired model in use moves to its replacement and says so; off = only a warning', async () => {
  const providers: ProviderConfig[] = [{ id: 'oc', label: 'Ollama Cloud (API key)', kind: 'openai-compatible', baseUrl: 'https://ollama.com/v1' }];
  const { catalog, settings, lists } = setup({ oc: ['gemma4:31b', 'kimi-k2.6', 'qwen3-coder:30b'] }, providers);
  const mia = new SettingsStore(scratch());
  mia.update({ companionModel: { providerId: 'oc', model: 'gemma4:31b' } });
  const cat = new ModelCatalog(join(scratch()), { settings, providerFor: (c) => new ListProvider(c, lists), companions: () => [{ name: 'Mia', settings: mia }], now: () => new Date('2026-10-27T12:00:00Z') });
  settings.update({ defaultProviderId: 'oc', defaultModel: 'kimi-k2.6', routes: { chat: { providerId: 'oc', model: 'gemma4:31b', fallbacks: [{ providerId: 'oc', model: 'kimi-k2.6' }] } } });
  void catalog;
  await cat.refresh('oc');
  lists.oc = ['gemma5:31b', 'kimi-k3', 'qwen3-coder:30b'];
  await cat.refresh('oc');
  assert.ok(!cat.isRetired('oc', 'gemma4:31b'), 'one check is not enough');
  await cat.refresh('oc');
  const s = settings.get();
  assert.equal(s.routes?.chat?.model, 'gemma5:31b');
  assert.equal(s.routes?.chat?.fallbacks?.[0].model, 'kimi-k3');
  assert.equal(s.defaultModel, 'kimi-k3');
  assert.equal(mia.get().companionModel?.model, 'gemma5:31b');
  const texts = cat.notices().map((n) => n.text);
  // UX 20: the ids the pickers show; UX 19: the same facts as data, for the app to translate.
  assert.ok(texts.includes('gemma4:31b was retired by Ollama Cloud (API key); Talking now uses gemma5:31b.'), texts.join('\n'));
  assert.ok(texts.some((x) => x.startsWith("gemma4:31b was retired by Ollama Cloud (API key); Mia's own model now uses")));
  const talk = cat.notices().find((n) => n.where === 'Talking');
  assert.deepEqual({ reason: talk?.reason, from: talk?.from, to: talk?.to, provider: talk?.provider, providerId: talk?.providerId, job: talk?.job }, { reason: 'retired', from: 'gemma4:31b', to: 'gemma5:31b', provider: 'Ollama Cloud (API key)', providerId: 'oc', job: 'chat' });
  assert.deepEqual(cat.retiredInUse(), []);

  // With the switch off: nothing changes, Health warns.
  settings.update({ modelAutoSwitch: false, routes: { coding: { providerId: 'oc', model: 'qwen3-coder:30b' } } });
  lists.oc = ['gemma5:31b', 'kimi-k3', 'qwen4-coder:30b'];
  await cat.refresh('oc');
  await cat.refresh('oc');
  assert.equal(settings.get().routes?.coding?.model, 'qwen3-coder:30b');
  const stuck = cat.retiredInUse();
  assert.equal(stuck.length, 1);
  assert.match(stuck[0].text, /qwen3-coder:30b was retired by Ollama Cloud \(API key\), but Coding still uses it/);
  assert.equal(stuck[0].reason, 'retired-auto-switch-off');
  assert.equal(stuck[0].from, 'qwen3-coder:30b');
  // Health shows it.
  const app = makeApp(scratch(), { now: new Date('2026-10-27T12:00:00Z') });
  closers.push(() => app.store.close());
  app.settings.update(settings.get());
  app.modelCatalog = cat;
  const h = healthReport(app, { version: 't', revision: null, startedAt: '' });
  assert.equal(h.checks.find((c) => c.name === 'Model lists')?.ok, false);
  assert.equal((h.checks.find((c) => c.name === 'Model lists')?.items?.[0] as { from?: string })?.from, 'qwen3-coder:30b');
  assert.ok(h.checks.find((c) => c.name === 'Model changes')?.detail.includes('Talking now uses gemma5:31b'));
  assert.ok((h.checks.find((c) => c.name === 'Model changes')?.items ?? []).some((n) => (n as { to?: string }).to === 'gemma5:31b'));
});

/** A fake Ollama daemon: its models, /api/tags with remote_host, pull, delete and chat. */
async function fakeDaemon(models: string[], opts: { signedIn?: boolean; noTags?: boolean } = {}) {
  const log: string[] = [];
  const have = new Set(models);
  const body = (req: IncomingMessage) => new Promise<string>((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b));
  });
  const json = (res: ServerResponse, code: number, v: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(v));
  };
  const { server, url } = await listen(async (req, res) => {
    const b = await body(req);
    log.push(`${req.method} ${req.url}${b ? ` ${b}` : ''}`);
    if (req.url === '/v1/models') return json(res, 200, { data: [...have].map((id) => ({ id })) });
    if (req.url === '/api/version') return json(res, 200, { version: '0.30.1' });
    if (req.url === '/api/tags' && opts.noTags) return json(res, 500, { error: 'busy' });
    if (req.url === '/api/tags') return json(res, 200, { models: [...have].map((name) => ({ name, ...(isCloudModelName(name) ? { remote_host: 'https://ollama.com' } : {}) })) });
    if (req.url === '/api/pull') {
      const m = JSON.parse(b).model as string;
      if (opts.signedIn === false) return json(res, 401, { error: 'unauthorized', signin_url: 'https://ollama.com/connect?x' });
      have.add(m);
      return json(res, 200, { status: 'success' });
    }
    if (req.url === '/api/delete') {
      have.delete(JSON.parse(b).model);
      return json(res, 200, {});
    }
    if (req.url === '/v1/chat/completions') {
      const m = JSON.parse(b).model as string;
      if (!have.has(m)) return json(res, 404, { error: { message: `model "${m}" not found, try pulling it first` } });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `hello from ${m}` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    json(res, 404, {});
  });
  closers.push(() => server.close());
  return { url, log, have };
}

function cloudCatalogFetch(ids: () => string[]): typeof fetch {
  return async (input, init) => {
    const u = String(input);
    if (u === 'https://fake-ollama.com/v1/models') return new Response(JSON.stringify({ data: ids().map((id) => ({ id, owned_by: 'ollama' })) }), { status: 200 });
    return fetch(input, init);
  };
}

test('Ollama daemon: the whole cloud catalog is offered; an unpulled one is pulled before its first use', async () => {
  const d = await fakeDaemon(['gemma4:12b', 'glm-5.2:cloud', 'nomic-embed-text:latest']);
  const dir = scratch();
  const app = makeApp(dir, { now: new Date('2026-10-27T12:00:00Z') });
  closers.push(() => app.store.close());
  const config: ProviderConfig = { id: 'ollama-pc', label: 'Ollama on my computer', kind: 'openai-compatible', baseUrl: `${d.url}/v1`, local: true };
  app.settings.update({ providers: [config], defaultProviderId: 'ollama-pc', defaultModel: 'gemma4:12b' });
  let ids = ['glm-5.2', 'gemma4:31b', 'minimax-m3.1-flash'];
  app.providerFactory = (c, key) => new OpenAICompatibleProvider(c, key);
  app.modelCatalog = new ModelCatalog(dir, { settings: app.settings, providerFor: (c) => new OpenAICompatibleProvider(c), fetch: cloudCatalogFetch(() => ids), cloudCatalogUrl: 'https://fake-ollama.com/v1/models', now: app.now });
  const cat = app.modelCatalog;
  const v = await cat.refresh('ollama-pc');
  assert.equal(v.options.daemon, true);
  assert.equal(v.options.ollamaCloud, true, 'on by default: the daemon already has a cloud model');
  assert.deepEqual(v.models, ['gemma4:12b', 'glm-5.2:cloud', 'gemma4:31b-cloud', 'minimax-m3.1-flash:cloud']);
  assert.deepEqual(v.entries.filter((e) => e.unpulled).map((e) => e.id), ['gemma4:31b-cloud', 'minimax-m3.1-flash:cloud']);
  assert.ok(!cat.needsPull(config, 'glm-5.2:cloud') && !cat.needsPull(config, 'gemma4:12b'));
  assert.ok(cat.needsPull(config, 'minimax-m3.1-flash:cloud'));

  // Two requests at once: one pull, then both talk.
  const turn = async () => {
    const { provider, model } = resolveProvider(app, 'ollama-pc', 'minimax-m3.1-flash:cloud');
    let out = '';
    for await (const ev of provider.stream({ model, messages: [{ role: 'user', content: 'hi' }] })) if (ev.type === 'text') out += ev.text;
    return out;
  };
  const [a, b] = await Promise.all([turn(), turn()]);
  assert.equal(a, 'hello from minimax-m3.1-flash:cloud');
  assert.equal(b, a);
  assert.equal(d.log.filter((l) => l.startsWith('POST /api/pull')).length, 1, 'pulled once');
  assert.ok(d.log.some((l) => l === 'POST /api/pull {"model":"minimax-m3.1-flash:cloud","stream":false}'));
  assert.ok(!cat.needsPull(config, 'minimax-m3.1-flash:cloud'));
  assert.ok(!cat.view('ollama-pc').entries.find((e) => e.id === 'minimax-m3.1-flash:cloud')?.unpulled);
  await turn();
  assert.equal(d.log.filter((l) => l.startsWith('POST /api/pull')).length, 1, 'not pulled again');

  // Retired from the cloud: hidden after two checks; removed only with the switch on; local never.
  ids = ['gemma4:31b', 'minimax-m3.1-flash'];
  await cat.refresh('ollama-pc');
  assert.ok(cat.view('ollama-pc').models.includes('glm-5.2:cloud'));
  await cat.refresh('ollama-pc');
  assert.ok(!cat.view('ollama-pc').models.includes('glm-5.2:cloud'), 'retired after two checks');
  assert.ok(d.have.has('glm-5.2:cloud'), 'not removed: the switch is off by default');
  assert.ok(!d.log.some((l) => l.startsWith('DELETE')));

  // Now with removal on. The local model gemma4:12b disappears from the daemon too, but local
  // models are never removed by Sara, only hidden.
  app.settings.update({ modelLists: { 'ollama-pc': { removeRetired: true } } });
  ids = ['gemma4:31b'];
  d.have.delete('gemma4:12b');
  await cat.refresh('ollama-pc');
  await cat.refresh('ollama-pc');
  const deletes = d.log.filter((l) => l.startsWith('DELETE'));
  assert.deepEqual(deletes, ['DELETE /api/delete {"model":"minimax-m3.1-flash:cloud"}']);
  assert.ok(!d.have.has('minimax-m3.1-flash:cloud'));
});

test('several Saras on one server: Ollama Cloud through the shared daemon is off for any other instance (hidden and refused before any request)', async () => {
  assert.equal(ollamaCloudDefault(true, 'sara'), true);
  assert.equal(ollamaCloudDefault(false, 'sara'), false);
  assert.equal(ollamaCloudDefault(true, 'work'), false);
  const d = await fakeDaemon(['gemma4:12b', 'glm-5.2:cloud', 'nomic-embed-text:latest']);
  const dir = scratch();
  const app = makeApp(dir, { now: new Date('2026-10-27T12:00:00Z') });
  closers.push(() => app.store.close());
  const config: ProviderConfig = { id: 'ollama-local', label: 'Ollama on the server', kind: 'openai-compatible', baseUrl: `${d.url}/v1`, local: true };
  app.settings.update({ providers: [config], defaultProviderId: 'ollama-local', defaultModel: 'gemma4:12b' });
  app.providerFactory = (c, key) => new OpenAICompatibleProvider(c, key);
  const prev = process.env.SARA_INSTANCE;
  process.env.SARA_INSTANCE = 'work';
  try {
    app.modelCatalog = new ModelCatalog(dir, { settings: app.settings, providerFor: (c) => new OpenAICompatibleProvider(c), fetch: cloudCatalogFetch(() => ['glm-5.2', 'gemma4:31b']), cloudCatalogUrl: 'https://fake-ollama.com/v1/models', now: app.now });
    const cat = app.modelCatalog;
    const v = await cat.refresh('ollama-local');
    assert.equal(v.options.ollamaCloud, false, 'off by default for another instance');
    assert.ok(v.models.includes('gemma4:12b'));
    assert.ok(!v.models.some(isCloudModelName), `the daemon's cloud models are not offered: ${v.models.join(', ')}`);
    const { provider, model } = resolveProvider(app, 'ollama-local', 'glm-5.2:cloud');
    assert.deepEqual(await provider.listModels(), ['gemma4:12b', 'nomic-embed-text:latest']);
    const before = d.log.length;
    await assert.rejects(async () => {
      for await (const _ of provider.stream({ model, messages: [{ role: 'user', content: 'hi' }] })) void _;
    }, /Ollama Cloud model: it runs on ollama\.com and is billed to the ollama\.com account/);
    assert.equal(d.log.length, before, 'refused before any request reached the daemon');
    // The owner of this Sara can turn it on (e.g. it's her own Ollama account).
    app.settings.update({ modelLists: { 'ollama-local': { ollamaCloud: true } } });
    assert.ok((await cat.refresh('ollama-local')).models.includes('glm-5.2:cloud'));
  } finally {
    if (prev === undefined) delete process.env.SARA_INSTANCE;
    else process.env.SARA_INSTANCE = prev;
  }
});

test('Ollama daemon: a clear message when it is not signed in to ollama.com; the catalog being down retires nothing', async () => {
  const d = await fakeDaemon(['gemma4:12b'], { signedIn: false });
  const dir = scratch();
  const app = makeApp(dir, { now: new Date('2026-10-27T12:00:00Z') });
  closers.push(() => app.store.close());
  const config: ProviderConfig = { id: 'ollama-local', label: 'Ollama on the server', kind: 'openai-compatible', baseUrl: `${d.url}/v1`, local: true };
  app.settings.update({ providers: [config], modelLists: { 'ollama-local': { ollamaCloud: true } } });
  let up = true;
  const f: typeof fetch = async (input, init) => (String(input).startsWith('https://fake-ollama.com') && !up ? new Response('', { status: 503 }) : cloudCatalogFetch(() => ['kimi-k3'])(input, init));
  app.providerFactory = (c, key) => new OpenAICompatibleProvider(c, key);
  app.modelCatalog = new ModelCatalog(dir, { settings: app.settings, providerFor: (c) => new OpenAICompatibleProvider(c), fetch: f, cloudCatalogUrl: 'https://fake-ollama.com/v1/models', now: app.now });
  const v = await app.modelCatalog.refresh('ollama-local');
  assert.equal(v.options.ollamaCloud, true, 'the owner turned it on');
  assert.deepEqual(v.models, ['gemma4:12b', 'kimi-k3:cloud']);
  const { provider, model } = resolveProvider(app, 'ollama-local', 'kimi-k3:cloud');
  await assert.rejects(
    async () => {
      for await (const _ of provider.stream({ model, messages: [{ role: 'user', content: 'hi' }] })) void _;
    },
    /isn't signed in to ollama\.com.*ollama signin/,
  );
  up = false;
  await app.modelCatalog.refresh('ollama-local');
  await app.modelCatalog.refresh('ollama-local');
  assert.deepEqual(app.modelCatalog.view('ollama-local').models, ['gemma4:12b', 'kimi-k3:cloud'], 'catalog unreachable: kept, nothing retired');
  // Switched off: only the daemon's own models.
  app.settings.update({ modelLists: { 'ollama-local': { ollamaCloud: false } } });
  await app.modelCatalog.refresh('ollama-local');
  await app.modelCatalog.refresh('ollama-local');
  assert.deepEqual(app.modelCatalog.view('ollama-local').models, ['gemma4:12b']);
});

test('API: the kept list with New and unpulled flags, Refresh, options, the auto-switch setting', async () => {
  const dir = scratch();
  const clock = { now: new Date('2026-10-27T12:00:00Z') };
  const app = makeApp(dir, clock);
  closers.push(() => app.store.close());
  const lists: Record<string, string[]> = { p: ['one', 'two'] };
  app.providerFactory = (c) => new ListProvider(c, lists);
  // No network in this test: the daemon probe (/api/version) gets a 404 here.
  app.modelCatalog = new ModelCatalog(dir, { settings: app.settings, providerFor: (c) => new ListProvider(c, lists), now: () => clock.now, fetch: async () => new Response('no', { status: 404 }) });
  const auth = new OwnerAuth(dir, () => clock.now);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  const { server: s, url } = await listen((req, res) => server.emit('request', req, res));
  closers.push(() => s.close());
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const r = await fetch(url + path, { method, headers: { authorization: `Bearer ${auth.newToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  let r = await call('/api/providers/p', 'PUT', { label: 'Prov', kind: 'openai-compatible', baseUrl: 'http://p/v1' });
  assert.equal(r.status, 200);
  // UX 15: adding a provider waits for its first check, so the answer already has its list.
  assert.ok((r.body.providers as { id: string; modelList: { checkedAt: string | null } }[]).find((p) => p.id === 'p')?.modelList.checkedAt);
  r = await call('/api/providers/p/models');
  assert.deepEqual(r.body.models, ['one', 'two']);
  assert.ok(r.body.checkedAt);
  lists.p = ['one', 'two', 'three'];
  r = await call('/api/providers/p/models');
  assert.deepEqual(r.body.models, ['one', 'two'], 'fresh: the kept list');
  clock.now = new Date('2026-10-27T13:00:00Z');
  r = await call('/api/providers/p/models/refresh', 'POST');
  assert.deepEqual(r.body.entries, [{ id: 'one' }, { id: 'two' }, { id: 'three', new: true }]);
  r = await call('/api/providers/p/models/options', 'PUT', { keepCurrent: false });
  assert.equal((r.body.options as { keepCurrent: boolean }).keepCurrent, false);
  r = await call('/api/providers');
  assert.equal((r.body.providers as { modelList: { options: { keepCurrent: boolean } } }[])[0].modelList.options.keepCurrent, false);
  r = await call('/api/settings');
  assert.equal(r.body.modelAutoSwitch, true, 'on by default');
  await call('/api/settings', 'PUT', { modelAutoSwitch: false });
  assert.equal((await call('/api/settings')).body.modelAutoSwitch, false);
  // A provider that can't be reached and was never checked answers with the reason.
  lists.q = new Error('Couldn\'t reach Q') as unknown as string[];
  await call('/api/providers/q', 'PUT', { label: 'Q', kind: 'openai-compatible', baseUrl: 'http://q/v1' });
  r = await call('/api/providers/q/models/refresh', 'POST');
  assert.equal(r.status, 502);
  assert.match(String(r.body.error), /reach Q/);
  // Removing a provider forgets its list.
  await call('/api/providers/p', 'DELETE');
  assert.equal(app.modelCatalog.known('p'), false);
});

test('model lists keep the provider\'s own order (Claude newest first), not alphabetical', () => {
  const listed = ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'claude-sonnet-5-5', 'claude-fable-5-1', 'opus'];
  const c = mergeCheck(undefined, listed, new Date('2026-10-27T12:00:00Z'));
  assert.deepEqual(c.order, listed);
});

test('hardening L1: a list that shrinks by more than half retires nothing and warns in Health', async () => {
  const { catalog, lists, settings } = setup({ p: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] });
  settings.update({ defaultProviderId: 'p', defaultModel: 'a3' });
  await catalog.refresh('p');
  lists.p = ['a1', 'a2'];
  let v = await catalog.refresh('p');
  v = await catalog.refresh('p');
  assert.deepEqual(v.models, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], 'the earlier list is kept');
  assert.equal(catalog.isRetired('p', 'a3'), false);
  assert.equal(settings.get().defaultModel, 'a3', 'nothing switched');
  assert.equal(v.warning?.reason, 'list-shrank');
  assert.deepEqual([v.warning?.before, v.warning?.now], [6, 2]);
  assert.deepEqual(catalog.warnings().map((w) => w.providerId), ['p']);
  // A normal change (same size, one swapped) still retires after two checks, and clears the warning.
  lists.p = ['a1', 'a2', 'a3', 'a4', 'a5', 'a7'];
  await catalog.refresh('p');
  v = await catalog.refresh('p');
  assert.ok(catalog.isRetired('p', 'a6'));
  assert.equal(v.warning, undefined);
  assert.deepEqual(catalog.warnings(), []);
});

test('hardening L1/L2: a daemon is found by /api/version, not its name; pulls only catalog names; deletes only confirmed cloud models', async () => {
  // Named like Ollama, but it is not one (no /api/version): no pulls, no deletes, no cloud catalog.
  const notOllama = await listen((req, res) => {
    res.writeHead(req.url === '/v1/models' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(req.url === '/v1/models' ? JSON.stringify({ data: [{ id: 'x-cloud' }, { id: 'y:cloud' }] }) : '{}');
  });
  closers.push(() => notOllama.server.close());
  const dir = scratch();
  const settings = new SettingsStore(dir);
  const proxy: ProviderConfig = { id: 'proxy', label: 'My Ollama proxy', kind: 'openai-compatible', baseUrl: `${notOllama.url}/v1` };
  settings.update({ providers: [proxy], modelLists: { proxy: { removeRetired: true, ollamaCloud: true } } });
  const seen: string[] = [];
  const f: typeof fetch = async (input, init) => {
    seen.push(String(input));
    return fetch(input, init);
  };
  const cat = new ModelCatalog(dir, { settings, providerFor: (c) => new OpenAICompatibleProvider(c), fetch: f, cloudCatalogUrl: 'https://fake-ollama.com/v1/models', now: () => new Date('2026-10-27T12:00:00Z') });
  const v = await cat.refresh('proxy');
  assert.equal(v.options.daemon, false);
  assert.equal(cat.needsPull(proxy, 'z:cloud'), false);
  assert.ok(seen.some((u) => u.endsWith('/api/version')));
  assert.ok(!seen.some((u) => u.includes('fake-ollama.com') || u.endsWith('/api/tags')), seen.join(' '));
  // Probed once per address (kept), not on every check.
  const n = seen.filter((u) => u.endsWith('/api/version')).length;
  await cat.refresh('proxy');
  assert.equal(seen.filter((u) => u.endsWith('/api/version')).length, n);

  // A real daemon (any name): only names in the current cloud catalog's unpulled set are pulled.
  const d = await fakeDaemon(['gemma4:12b', 'glm-5.2:cloud']);
  const dir2 = scratch();
  const app = makeApp(dir2, { now: new Date('2026-10-27T12:00:00Z') });
  closers.push(() => app.store.close());
  const config: ProviderConfig = { id: 'box', label: 'Box', kind: 'openai-compatible', baseUrl: `${d.url}/v1` };
  app.settings.update({ providers: [config] });
  app.modelCatalog = new ModelCatalog(dir2, { settings: app.settings, providerFor: (c) => new OpenAICompatibleProvider(c), fetch: cloudCatalogFetch(() => ['glm-5.2', 'kimi-k3']), cloudCatalogUrl: 'https://fake-ollama.com/v1/models', now: app.now });
  const w = await app.modelCatalog.refresh('box');
  assert.equal(w.options.daemon, true, 'found by its answer, not its name');
  assert.ok(app.modelCatalog.needsPull(config, 'kimi-k3:cloud'));
  assert.equal(app.modelCatalog.needsPull(config, 'someone/x-cloud'), false, 'not in the catalog: never pulled');
  assert.equal(app.modelCatalog.needsPull(config, 'kimi-k9:cloud'), false, 'a typo is never pulled');

  // Retired, removal on, but /api/tags can't confirm the model runs on Ollama's servers: kept.
  const d2 = await fakeDaemon(['gemma4:12b', 'glm-5.2:cloud', 'kimi-k3:cloud', 'qwen4:cloud'], { noTags: true });
  const dir3 = scratch();
  const s3 = new SettingsStore(dir3);
  const c3: ProviderConfig = { id: 'box2', label: 'Box 2', kind: 'openai-compatible', baseUrl: `${d2.url}/v1` };
  s3.update({ providers: [c3], modelLists: { box2: { removeRetired: true, ollamaCloud: true } } });
  let ids = ['glm-5.2', 'kimi-k3', 'qwen4'];
  const cat3 = new ModelCatalog(dir3, { settings: s3, providerFor: (c) => new OpenAICompatibleProvider(c), fetch: cloudCatalogFetch(() => ids), cloudCatalogUrl: 'https://fake-ollama.com/v1/models', now: () => new Date('2026-10-27T12:00:00Z') });
  await cat3.refresh('box2');
  ids = ['kimi-k3', 'qwen4'];
  await cat3.refresh('box2');
  await cat3.refresh('box2');
  assert.ok(cat3.isRetired('box2', 'glm-5.2:cloud'));
  assert.ok(!d2.log.some((l) => l.startsWith('DELETE')), d2.log.join('\n'));
  assert.ok(d2.have.has('glm-5.2:cloud'));
});
