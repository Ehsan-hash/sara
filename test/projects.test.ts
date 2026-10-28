// Conversations in projects, moving between them, archive and delete (with or without forgetting).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

test('projects group conversations; move, archive, delete keep or forget memories', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex' });
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };

  const loose = (await call('POST', '/api/conversations', {})).body;
  assert.equal(loose.projectId, null, 'a conversation can live outside any project');

  const proj = await call('POST', '/api/projects', { name: 'Weather app', workspace: 'weather' });
  assert.equal(proj.status, 201);
  assert.equal(proj.body.workspace, 'weather');
  const bad = await call('POST', '/api/projects', { name: '  ' });
  assert.equal(bad.status, 400);

  // New conversation inside the project uses its workspace.
  const inside = (await call('POST', '/api/conversations', { projectId: proj.body.id })).body;
  assert.equal(inside.projectId, proj.body.id);
  assert.equal(inside.workspace, 'weather');

  // Move the loose one in later, without bumping it to the top of the list.
  const before = app.store.getConversation(loose.id)!.updatedAt;
  const moved = (await call('PATCH', `/api/conversations/${loose.id}`, { projectId: proj.body.id })).body;
  assert.equal(moved.projectId, proj.body.id);
  assert.equal(moved.updatedAt, before);
  assert.equal((await call('PATCH', `/api/conversations/${loose.id}`, { projectId: 9999 })).status, 400);
  const list = (await call('GET', '/api/projects')).body;
  assert.equal(list.find((p: { id: number }) => p.id === proj.body.id).conversations, 2);

  // Archive hides nothing on the server: it is just marked; a new message brings it back.
  const arch = (await call('PATCH', `/api/conversations/${inside.id}`, { archived: true })).body;
  assert.ok(arch.archivedAt);
  assert.equal(arch.projectId, proj.body.id, 'archiving keeps the project');
  app.store.addMessage(inside.id, 'user', 'back again');
  assert.equal(app.store.getConversation(inside.id)!.archivedAt, null);

  // Delete keeps memories by default…
  app.memory!.add({ kind: 'fact', content: 'Owner is building a weather app.', conversationId: loose.id, sourceMessageId: null, happenedOn: '2026-10-24' });
  assert.equal((await call('GET', `/api/conversations/${loose.id}/memories`)).body.count, 1);
  await call('DELETE', `/api/conversations/${loose.id}`);
  assert.equal(app.store.getConversation(loose.id), undefined);
  assert.equal(app.memory!.list({ q: 'weather app' }).length, 1, 'memory survives a plain delete');

  // …and forgets them when asked.
  const other = (await call('POST', '/api/conversations', {})).body;
  app.memory!.add({ kind: 'fact', content: 'Owner likes green tea.', conversationId: other.id, sourceMessageId: null, happenedOn: '2026-10-24' });
  const del = await call('DELETE', `/api/conversations/${other.id}?forget=1`);
  assert.equal(del.body.forgotten, 1);
  assert.equal(app.memory!.list({ q: 'green tea' }).length, 0);

  // Project page: conversations, to-dos, notes and workspace files in one call; files viewable.
  await call('POST', '/api/tasks', { title: 'Ship radar', project: 'Weather app' });
  await call('POST', '/api/notes', { body: 'Use NOAA tiles', project: 'Weather app' });
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(app.dataDir, 'workspaces', 'weather', 'src'), { recursive: true });
  writeFileSync(join(app.dataDir, 'workspaces', 'weather', 'src', 'app.ts'), 'console.log(1);');
  mkdirSync(join(app.dataDir, 'workspaces', 'weather', 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(app.dataDir, 'workspaces', 'weather', 'node_modules', 'x', 'i.js'), '');
  const page = (await call('GET', `/api/projects/${proj.body.id}`)).body;
  assert.equal(page.conversations.length, 1, 'the one left after the deletes above');
  assert.deepEqual(page.tasks.map((x: { title: string }) => x.title), ['Ship radar']);
  assert.equal(page.notes.length, 1);
  assert.deepEqual(page.files.map((f: { path: string }) => f.path), ['src/app.ts'], 'dependency folders skipped');
  const file = (await call('GET', '/api/workspaces/weather/file?path=src/app.ts')).body;
  assert.equal(file.text, 'console.log(1);');
  assert.equal((await call('GET', '/api/workspaces/weather/file?path=../../sara.db')).status, 400);

  // Deleting a project leaves its conversations, now without a project.
  const pd = await call('DELETE', `/api/projects/${proj.body.id}`);
  assert.equal(pd.body.moved, 1);
  assert.equal(app.store.getConversation(inside.id)!.projectId, null);
});

test('regenerate, edit, continue, search; replies record their model', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex' });
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const post = async (path: string, body: unknown) => (await fetch(base + path, { method: 'POST', headers: H, body: JSON.stringify(body) })).text();
  app.settings.update({ disclosureAcceptedAt: '2026-10-24T19:00:00Z' });
  const conv = app.store.createConversation({});
  const say = (...parts: string[]) => app.script.push(parts.map((p) => ({ type: 'text' as const, text: p })));

  say('First answer about pancakes.');
  await post(`/api/conversations/${conv.id}/messages`, { content: 'Tell me about pancakes' });
  let msgs = app.store.messages(conv.id).filter((m) => m.role !== 'notice');
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant']);
  assert.equal(msgs[1].meta?.model, 'm', 'which model answered');

  say('Second answer.');
  await post(`/api/conversations/${conv.id}/retry`, {});
  msgs = app.store.messages(conv.id).filter((m) => m.role !== 'notice');
  assert.deepEqual(msgs.map((m) => m.content), ['Tell me about pancakes', 'Second answer.'], 'regenerate replaces the reply');

  say('Waffles!');
  await post(`/api/conversations/${conv.id}/retry`, { content: 'Tell me about waffles' });
  msgs = app.store.messages(conv.id).filter((m) => m.role !== 'notice');
  assert.deepEqual(msgs.map((m) => m.content), ['Tell me about waffles', 'Waffles!'], 'edit replaces the question and the reply');

  // A reply cut off: only the owner message is stored. Continue answers it without a new message.
  app.store.addMessage(conv.id, 'user', 'And crepes?');
  say('Crepes are thin.');
  await post(`/api/conversations/${conv.id}/continue`, {});
  msgs = app.store.messages(conv.id).filter((m) => m.role !== 'notice');
  assert.deepEqual(msgs.slice(-2).map((m) => m.content), ['And crepes?', 'Crepes are thin.']);
  assert.equal(msgs.filter((m) => m.role === 'user').length, 2);

  const found = await (await fetch(`${base}/api/find?q=${encodeURIComponent('crepes THIN')}`, { headers: H })).json();
  assert.equal(found[0].conversationId, conv.id);
  assert.equal(found[0].role, 'assistant');
  assert.match(found[0].snippet, /Crepes are thin/);
});

test('photos: saved by content, sent to the model, served to the owner, kept on regenerate, pruned on delete', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', disclosureAcceptedAt: '2026-10-24T19:00:00Z' });
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const post = async (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
  // Smallest valid PNG (1x1).
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const conv = app.store.createConversation({});
  await (await post(`/api/conversations/${conv.id}/messages`, { content: 'What is this?', images: [png] })).text();
  const req = app.requests.at(-1)!;
  const user = req.messages.findLast((m) => m.role === 'user') as { images?: { mime: string; data: string }[] };
  assert.equal(user.images?.length, 1);
  assert.equal(user.images![0].mime, 'image/png');
  const stored = app.store.messages(conv.id).find((m) => m.role === 'user')!;
  const id = (stored.meta!.images as string[])[0];
  assert.match(id, /^[0-9a-f]{32}\.png$/);
  const got = await fetch(`${base}/api/uploads/${id}`, { headers: H });
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/api/uploads/${id}`)).status, 401, 'only the owner can see photos');
  assert.equal((await fetch(`${base}/api/uploads/..%2Fsara.db`, { headers: H })).status, 404);

  // Fake files are refused.
  const bad = await post(`/api/conversations/${conv.id}/messages`, { content: 'x', images: ['data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64')] });
  assert.equal(bad.status, 400);

  // Regenerate keeps the photo.
  await (await post(`/api/conversations/${conv.id}/retry`, {})).text();
  assert.deepEqual(app.store.messages(conv.id).find((m) => m.role === 'user')!.meta?.images, [id]);

  // Delete removes photos no other message uses.
  await fetch(`${base}/api/conversations/${conv.id}`, { method: 'DELETE', headers: H });
  assert.equal(app.uploads!.get(id), undefined);
});
