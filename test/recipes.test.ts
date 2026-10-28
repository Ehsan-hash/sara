// Phase 50: recipes. Saving (same title updates), editing, deleting, finding by words and meaning,
// the tools (saving asks the owner by default), the two recipes named at the start of a coding
// turn, export/import round trip, and the owner-only API behind Settings → Abilities → Recipes.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { runTurn, type ChatEvent } from '../src/chat.ts';
import { exportAll, importAll } from '../src/export.ts';
import { createRecipeTools, RecipeStore, recipesSection } from '../src/recipes.ts';
import { createSaraServer } from '../src/server.ts';
import type { ToolContext } from '../src/tools/types.ts';
import { call, fakeEmbedder, makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';

function setup(t: { after: (fn: () => void) => void }, now = new Date('2026-10-27T15:00:00Z')): TestApp {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now });
  app.recipes = new RecipeStore(app.store.db, () => app.now());
  for (const tl of createRecipeTools(() => app)) app.tools.add(tl);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'UTC', disclosureAcceptedAt: now.toISOString() });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  return app;
}

const DEPLOY = { title: 'Deploy the weather app', whenToUse: 'When the weather site needs to go live on the server', steps: '1. `npm run build`\n2. `rsync -a dist/ server:/var/www/weather`\n3. Open https://weather.example and check the forecast loads.' };
const FLAKY = { title: 'Fix flaky tests', whenToUse: 'Tests pass and fail at random', steps: '1. Run the suite 10 times with `--repeat 10`.\n2. Look for shared temp folders and timers.\n3. Await every server close.' };

test('store: save, same title updates (not a second copy), edit, use, delete; input is cleaned', (t) => {
  const app = setup(t);
  const rs = app.recipes!;
  const a = rs.save({ ...DEPLOY, workspace: 'weather', tags: ['Deploy', 'deploy', ' web '], sourceConversationId: 'c1' });
  assert.equal(a.updated, false);
  assert.deepEqual(a.recipe.tags, ['deploy', 'web']);
  assert.equal(a.recipe.workspace, 'weather');
  assert.equal(a.recipe.sourceConversationId, 'c1');
  const again = rs.save({ ...DEPLOY, title: 'deploy the WEATHER app', steps: 'new steps', workspace: 'weather' });
  assert.equal(again.updated, true);
  assert.equal(again.recipe.id, a.recipe.id);
  assert.equal(rs.count(), 1);
  // The same title for another workspace is its own recipe.
  assert.equal(rs.save({ ...DEPLOY, workspace: null }).updated, false);
  assert.equal(rs.count(), 2);
  const edited = rs.update(a.recipe.id, { title: '  Deploy\n weather  ', steps: '1. build\r\n2. ship', workspace: '' })!;
  assert.equal(edited.title, 'Deploy weather');
  assert.equal(edited.steps, '1. build\n2. ship');
  assert.equal(edited.workspace, null);
  assert.throws(() => rs.update(a.recipe.id, { title: '' }), /needs a title/);
  assert.throws(() => rs.save({ title: 'x', steps: '  ' }), /needs its steps/);
  assert.throws(() => rs.save({ title: 'x', steps: 'y', workspace: '../etc' }), /isn't a workspace name/);
  const used = rs.markUsed(a.recipe.id)!;
  assert.equal(used.uses, 1);
  assert.equal(used.lastUsedAt, '2026-10-27T15:00:00.000Z');
  assert.equal(rs.delete(a.recipe.id), true);
  assert.equal(rs.delete(a.recipe.id), false);
  assert.equal(rs.count(), 1);
});

test('find: by words (scoped to the workspace or any), and by meaning with a (fake) embedder', async (t) => {
  const app = setup(t);
  const rs = app.recipes!;
  const deploy = rs.save({ ...DEPLOY, workspace: 'weather' }).recipe;
  const flaky = rs.save({ ...FLAKY, workspace: null }).recipe;
  rs.save({ title: 'Deploy the blog', whenToUse: 'Publishing the blog', steps: 'hugo && rsync', workspace: 'blog' });
  assert.deepEqual((await rs.find('deploy the weather site', { workspace: 'weather' })).map((r) => r.id)[0], deploy.id);
  assert.ok(!(await rs.find('deploy', { workspace: 'weather' })).some((r) => r.workspace === 'blog'), "another workspace's recipe stays out");
  assert.equal((await rs.find('flaky tests', { workspace: 'weather' }))[0].id, flaky.id, 'any-workspace recipes are found everywhere');
  // Meaning: "ship it to production" shares no word with the deploy recipe.
  assert.deepEqual(await rs.find('ship it to production', { workspace: 'weather' }), []);
  const url = await fakeEmbedder(t);
  const target = { config: { id: 'emb', label: 'Fake', kind: 'openai-compatible' as const, baseUrl: url }, model: 'fake-embed' };
  const byMeaning = await rs.find('ship it to production', { workspace: 'weather', target });
  assert.equal(byMeaning[0].id, deploy.id);
  assert.equal((await rs.find('tests fail intermittently', { workspace: 'weather', target }))[0].id, flaky.id);
});

test('tools: recipe_save asks the owner by default (owner can allow it); find and use are automatic; use counts', async (t) => {
  const app = setup(t);
  const tools = Object.fromEntries(createRecipeTools(() => app).map((x) => [x.spec.name, x]));
  assert.equal(tools.recipe_save.defaultPermission, 'ask');
  assert.equal(app.tools.permission('recipe_save', undefined), 'ask');
  assert.equal(app.tools.permission('recipe_save', { recipe_save: 'auto' }), 'auto', 'the owner can let her save without asking');
  assert.equal(tools.recipe_find.defaultPermission, 'auto');
  assert.equal(tools.recipe_use.defaultPermission, 'auto');
  const conv = app.store.createConversation({ mode: 'coding', workspace: 'weather' });
  const ctx = { workspaceDir: app.dataDir, signal: new AbortController().signal, sandbox: { mode: 'none', network: true, detail: '' }, conversationId: conv.id } as ToolContext;
  assert.match(await tools.recipe_find.run({ query: 'deploy' }, ctx), /No recipes saved yet/);
  const saved = await tools.recipe_save.run({ title: DEPLOY.title, when_to_use: DEPLOY.whenToUse, steps: DEPLOY.steps, tags: ['deploy'] }, ctx);
  assert.match(saved, /Saved recipe #1 “Deploy the weather app” for workspace weather/);
  assert.equal(app.recipes!.get(1)!.sourceConversationId, conv.id);
  assert.match(await tools.recipe_save.run({ title: 'Anywhere', when_to_use: 'x', steps: 'y', workspace: 'any' }, ctx), /for any workspace/);
  assert.match(await tools.recipe_find.run({ query: 'deploy weather' }, ctx), /^#1 Deploy the weather app \[weather\] — when: When the weather site needs to go live on the server \(used 0×\)/);
  const opened = await tools.recipe_use.run({ id: 1 }, ctx);
  assert.match(opened, /Recipe #1: Deploy the weather app/);
  assert.match(opened, /`npm run build`/);
  assert.equal(app.recipes!.get(1)!.uses, 1);
  await assert.rejects(tools.recipe_use.run({ id: 99 }, ctx), /No recipe #99/);
  // Partner chats (someone else talking to her) can't reach them.
  const partner = app.store.createConversation({ channel: 'telegram', channelKey: '1', partner: 'Ana' });
  await assert.rejects(tools.recipe_find.run({ query: 'deploy' }, { ...ctx, conversationId: partner.id }), /private to the owner/);
});

test('turn: a coding request names up to two fitting recipes in her instructions; saving shows an approval card', async (t) => {
  const app = setup(t);
  app.now = () => new Date();
  const rs = app.recipes!;
  rs.save({ ...DEPLOY, workspace: 'weather' });
  rs.save({ ...FLAKY, workspace: null });
  rs.save({ title: 'Deploy the blog', whenToUse: 'Publishing the blog', steps: 'hugo', workspace: 'blog' });
  rs.save({ title: 'Rotate the logs', whenToUse: 'Disk full of logs', steps: 'logrotate', workspace: null });
  assert.equal(await recipesSection(app, 'weather', 'hello there'), undefined, 'nothing fits: nothing added');
  const conv = app.store.createConversation({ mode: 'coding', workspace: 'weather' });
  app.script.push(text('On it.'));
  for await (const ev of runTurn(app, conv.id, 'please deploy the weather site, the tests were flaky last time')) void ev;
  const system = app.requests[0].messages[0].content;
  const block = system.slice(system.indexOf('Recipes you saved'));
  assert.match(block, /#1 Deploy the weather app \[weather\] — when: When the weather site needs to go live/);
  assert.match(block, /#2 Fix flaky tests — when: Tests pass and fail at random/);
  assert.doesNotMatch(block, /Deploy the blog|Rotate the logs/);
  assert.match(system, /open one with recipe_use before following it/);
  assert.match(system, /offer to save how you did it with recipe_save/);
  // A plain chat (not coding) gets no recipes.
  const chat = app.store.createConversation({ workspace: 'weather' });
  app.script.push(text('Sure.'));
  for await (const ev of runTurn(app, chat.id, 'deploy the weather site')) void ev;
  assert.doesNotMatch(app.requests[1].messages[0].content, /Recipes you saved/);
  // Saving asks first: the approval card shows what she wrote.
  app.script.push([call('s1', 'recipe_save', { title: 'Deploy weather v2', when_to_use: 'going live', steps: '1. build' })], text('Saved, if you said yes.'));
  const events: ChatEvent[] = [];
  const gen = runTurn(app, conv.id, 'save how we did that');
  for await (const ev of gen) {
    events.push(ev);
    if (ev.type === 'approval') app.approvals.decide(ev.approvalId, true);
  }
  const card = events.find((e) => e.type === 'approval') as Extract<ChatEvent, { type: 'approval' }>;
  assert.equal(card.summary, 'Save recipe “Deploy weather v2”');
  assert.ok(rs.list().some((r) => r.title === 'Deploy weather v2'));
});

test('export/import: recipes round trip (fields kept, second import adds nothing)', (t) => {
  const a = setup(t);
  const b = setup(t);
  const conv = a.store.createConversation({ mode: 'coding', workspace: 'weather' });
  const r1 = a.recipes!.save({ ...DEPLOY, workspace: 'weather', tags: ['deploy'], sourceConversationId: conv.id }).recipe;
  a.recipes!.markUsed(r1.id);
  a.recipes!.save({ ...FLAKY });
  const file = JSON.parse(JSON.stringify(exportAll(a)));
  assert.equal(file.recipes.length, 2);
  const res = importAll(b, file);
  assert.equal(res.recipes, 2);
  const got = b.recipes!.list().find((r) => r.title === DEPLOY.title)!;
  assert.equal(got.whenToUse, DEPLOY.whenToUse);
  assert.equal(got.steps, DEPLOY.steps);
  assert.equal(got.workspace, 'weather');
  assert.deepEqual(got.tags, ['deploy']);
  assert.equal(got.uses, 1);
  assert.equal(got.createdAt, r1.createdAt);
  assert.equal(got.sourceConversationId, conv.id, 'its conversation came along');
  assert.equal(importAll(b, file).recipes, 0, 'no duplicates');
  // Files from before recipes still import.
  delete file.recipes;
  assert.equal(importAll(b, file).recipes, undefined);
  // Found by words right after import (the search index is filled too).
  return b.recipes!.find('flaky').then((r) => assert.equal(r[0]?.title, FLAKY.title));
});

test('API: list, read, edit, delete (owner only; not in the demo)', async (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date() };
  const app = makeApp(dir, clock);
  app.recipes = new RecipeStore(app.store.db);
  mkdirSync(join(dir, 'demo'), { recursive: true });
  const demoApp = makeApp(join(dir, 'demo'), clock);
  demoApp.recipes = new RecipeStore(demoApp.store.db);
  const auth = new OwnerAuth(dir, () => clock.now);
  const token = auth.newToken!;
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  const demo = createSaraServer({ app: demoApp, auth: new OwnerAuth(join(dir, 'demo'), () => clock.now), webDir: join(ROOT, 'web'), demo: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => demo.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    demo.close();
    app.store.close();
    demoApp.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const id = app.recipes.save({ ...DEPLOY, workspace: 'weather' }).recipe.id;
  assert.equal((await fetch(`${base}/api/recipes`)).status, 401);
  const dbase = `http://127.0.0.1:${(demo.address() as AddressInfo).port}`;
  const d = await fetch(`${dbase}/api/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await fetch(`${dbase}/api/recipes`, { headers: { cookie: d.headers.get('set-cookie')!.split(';')[0] } })).status, 403);
  const list = (await (await fetch(`${base}/api/recipes`, { headers: h })).json()) as { recipes: { id: number; title: string }[] };
  assert.deepEqual(list.recipes.map((r) => r.title), [DEPLOY.title]);
  const one = (await (await fetch(`${base}/api/recipes/${id}`, { headers: h })).json()) as { steps: string };
  assert.equal(one.steps, DEPLOY.steps);
  const patched = (await (await fetch(`${base}/api/recipes/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ title: 'Ship weather', steps: '1. ship', workspace: '' }) })).json()) as { title: string; steps: string; workspace: string | null; whenToUse: string };
  assert.deepEqual([patched.title, patched.steps, patched.workspace, patched.whenToUse], ['Ship weather', '1. ship', null, DEPLOY.whenToUse]);
  assert.equal((await fetch(`${base}/api/recipes/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ title: '' }) })).status, 400);
  assert.equal((await fetch(`${base}/api/recipes/${id}`, { method: 'DELETE', headers: h })).status, 200);
  assert.equal((await fetch(`${base}/api/recipes/${id}`, { headers: h })).status, 404);
  assert.equal(app.recipes.count(), 0);
});
