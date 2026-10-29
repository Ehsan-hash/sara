// Phase 70: "Our moments": the album store and its one-time backfill, captions by a scripted model
// (and the picture model), the safety block on captions, privacy (private/partner/group/imported/
// work/other-app conversations stay out; nothing over MCP or /v1), the demo refusal, delete
// semantics, albums, "On this day", and her tool's channel rules and once-a-day limit.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { runTurn } from '../src/chat.ts';
import { BACKFILL_CAPTIONS, cleanCaption, createMomentsTool, MomentsStore, MomentsWorker, parseCaptionAnswer } from '../src/moments.ts';
import { createScrapbookTool } from '../src/scrapbook.ts';
import { createSaraServer } from '../src/server.ts';
import type { ToolContext } from '../src/tools/types.ts';
import { makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const fakeImg = (n: number) => `${n.toString(16).padStart(32, '0')}.jpg`;

function setup(t: { after: (fn: () => void) => void }, now = new Date('2026-10-28T18:00:00Z')) {
  const { dir, cleanup } = tempDir();
  const clock = { now };
  const app = makeApp(dir, clock);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'UTC', disclosureAcceptedAt: now.toISOString() });
  const book = new MomentsStore(app.store.db, () => clock.now);
  app.moments = book;
  const worker = new MomentsWorker(app, book);
  app.momentsWorker = worker;
  app.tools.add(createScrapbookTool(app.scrapbook!));
  app.tools.add(createMomentsTool(() => app, book));
  const closers: (() => void)[] = [];
  t.after(() => {
    for (const c of closers) c();
    app.store.close();
    cleanup();
  });
  return { app, book, worker, clock, closers };
}

async function serve(app: TestApp, closers: (() => void)[], opts: { demo?: boolean } = {}) {
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web'), ...(opts.demo ? { demo: true } : {}) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.unshift(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const j = async (method: string, path: string, body?: unknown, headers: Record<string, string> = H) => {
    const res = await fetch(`${base}/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  return { base, auth, j };
}

const ctxFor = (conversationId: string, attached: string[] = []): ToolContext => ({ workspaceDir: '.', signal: new AbortController().signal, sandbox: { mode: 'none', network: false, detail: '' }, conversationId, attachImage: (id) => attached.push(id) });

test('album: backfill brings in photos and kept moments from shareable conversations only; caption limit; removed stays removed', async (t) => {
  const { app, book } = setup(t);
  const web = app.store.createConversation({ title: 'Beach day' });
  const mine = app.store.addMessage(web.id, 'user', 'Look at this sunset!', { images: [fakeImg(1)] });
  const hers = app.store.addMessage(web.id, 'assistant', 'And here is me!', { images: [fakeImg(2)] });
  app.store.addMessage(web.id, 'tool', 'screenshot', { images: [fakeImg(3)] }); // her tool's screenshot: not a moment
  const priv = app.store.createConversation({ private: true });
  const privMsg = app.store.addMessage(priv.id, 'user', 'secret', { images: [fakeImg(4)] });
  const partner = app.store.createConversation({ channel: 'telegram', partner: 'Sam' });
  const partnerMsg = app.store.addMessage(partner.id, 'user', 'hi', { images: [fakeImg(5)] });
  const group = app.store.createConversation({ channel: 'group' });
  const groupMsg = app.store.addMessage(group.id, 'user', 'us all', { images: [fakeImg(6)] });
  for (const channel of ['import-chatgpt', 'discord-work', 'mcp', 'api', 'telegram-nsfw']) {
    const c = app.store.createConversation({ channel });
    app.store.addMessage(c.id, 'user', 'x', { images: [fakeImg(7)] });
  }
  // A kept moment without a photo becomes a words-only item; a kept photo message is marked.
  const words = app.store.addMessage(web.id, 'assistant', 'The great pancake incident.');
  app.scrapbook!.add({ kind: 'moment', text: words.content, conversationId: web.id, messageId: words.id });
  app.scrapbook!.add({ kind: 'moment', text: mine.content, conversationId: web.id, messageId: mine.id });
  app.scrapbook!.add({ kind: 'joke', text: 'Never trust a waffle.' }); // jokes stay in the scrapbook

  assert.equal(book.sync(app.store, 'all'), 3);
  const items = book.list({ adultOk: true });
  assert.deepEqual(items.map((m) => m.image ?? m.kind).sort(), [fakeImg(1), fakeImg(2), 'moment']);
  assert.equal(items.find((m) => m.image === fakeImg(1))!.pinned, true);
  assert.equal(items.find((m) => m.image === fakeImg(1))!.from, 'owner');
  assert.equal(items.find((m) => m.image === fakeImg(2))!.from, 'sara');
  assert.equal(items.find((m) => m.image === fakeImg(2))!.messageId, hers.id);
  assert.ok(items.every((m) => m.captionState === 'pending'));
  // A second sync adds nothing new.
  assert.equal(book.sync(app.store, 'all'), 0);

  // Private conversations and group chats only by hand; other people's chats never.
  assert.throws(() => book.addByHand(app.store, partnerMsg.id), /other people/);
  assert.equal(book.addByHand(app.store, privMsg.id)[0].byHand, true);
  assert.equal(book.addByHand(app.store, groupMsg.id).length, 1);

  // Remove from moments: hidden, the message keeps its photo, a later sync doesn't bring it back.
  const two = items.find((m) => m.image === fakeImg(2))!;
  assert.ok(book.remove(two.id));
  assert.deepEqual(app.store.messageById(hers.id)!.meta!.images, [fakeImg(2)]);
  app.store.addMessage(web.id, 'user', 'another', { images: [fakeImg(8)] });
  assert.equal(book.sync(app.store, 'all'), 1);
  assert.equal(book.list({ adultOk: true }).some((m) => m.image === fakeImg(2)), false);
  // Adding it back by hand brings it back.
  book.addByHand(app.store, hers.id);
  assert.equal(book.list({ adultOk: true }).some((m) => m.image === fakeImg(2)), true);
  // Deleting the conversation empties its moments.
  app.store.deleteConversation(priv.id);
  book.prune();
  assert.equal(book.list({ adultOk: true }).some((m) => m.image === fakeImg(4)), false);
  // The nsfw channel's photo never came in; adult items stay hidden without adultOk.
  assert.equal(book.list({ adultOk: true }).some((m) => m.image === fakeImg(7)), false);

  // The one-time backfill writes only the newest captions by itself.
  const { app: big, book: bigBook } = setup(t);
  const c = big.store.createConversation({});
  for (let i = 0; i < BACKFILL_CAPTIONS + 5; i++) big.store.addMessage(c.id, 'user', `photo ${i}`, { images: [fakeImg(100 + i)] });
  assert.equal(bigBook.sync(big.store, 'all'), BACKFILL_CAPTIONS + 5);
  assert.equal(bigBook.pendingCount(), BACKFILL_CAPTIONS);
  assert.equal(bigBook.waitingCount(), 5);
  assert.equal(bigBook.list({ adultOk: true }).at(-1)!.captionState, 'none', 'the oldest wait for the owner');
  assert.equal(bigBook.requestMore(), 5);
  assert.equal(bigBook.pendingCount(), BACKFILL_CAPTIONS + 5);
});

test('album: "only kept moments" and "off" modes', (t) => {
  const { app, book } = setup(t);
  const c = app.store.createConversation({});
  const a = app.store.addMessage(c.id, 'user', 'one', { images: [fakeImg(1)] });
  assert.equal(book.sync(app.store, 'pinned'), 0);
  app.scrapbook!.add({ kind: 'moment', text: 'one', conversationId: c.id, messageId: a.id });
  assert.equal(book.sync(app.store, 'pinned'), 1);
  app.store.addMessage(c.id, 'user', 'two', { images: [fakeImg(2)] });
  assert.equal(book.sync(app.store, 'off'), 0);
  app.store.addMessage(c.id, 'user', 'three', { images: [fakeImg(3)] });
  // Switching to "all photos" brings in what came while it was off (as a backfill).
  assert.equal(book.sync(app.store, 'all'), 2);
  app.store.addMessage(c.id, 'user', 'four', { images: [fakeImg(4)] });
  assert.equal(book.sync(app.store, 'all'), 1);
  assert.equal(book.list({ adultOk: true }).length, 4);
});

test('captions: her own words from the conversation; the picture model looks at photos from the owner; place and "us" fill the albums', async (t) => {
  const { app, book, worker } = setup(t);
  const c = app.store.createConversation({ title: 'Pier' });
  app.store.addMessage(c.id, 'user', 'We finally made it to the pier at sunset');
  const photo = app.uploads!.save(PNG).id;
  app.store.addMessage(c.id, 'user', '(photo)', { images: [photo] });
  app.store.addMessage(c.id, 'assistant', 'That light! You and the gulls.');
  // No picture model: written from the conversation only.
  app.script.push(text('CAPTION: "The evening you dragged me to the pier and the gulls stole the show."\nPLACE: Santa Monica pier\nUS: yes'));
  const r = await worker.tick();
  assert.equal(r.added, 1);
  assert.equal(r.captioned, 1);
  const m = book.list({ adultOk: true })[0];
  assert.equal(m.caption, 'The evening you dragged me to the pier and the gulls stole the show.');
  assert.equal(m.captionState, 'done');
  assert.equal(m.place, 'Santa Monica pier');
  assert.equal(m.us, true);
  const req = app.requests.at(-1)!;
  const note = String(req.messages.at(-1)!.content);
  assert.match(note, /finally made it to the pier/);
  assert.match(note, /Alex \[sends THE photo\]/);
  assert.match(String(req.messages[0].content), /You are Sara/);
  assert.equal((req.messages.at(-1) as { images?: unknown[] }).images, undefined, 'the talking model "m" can\'t see: no picture sent');
  assert.deepEqual(book.list({ album: 'us' }).map((x) => x.id), [m.id]);
  assert.deepEqual(book.list({ album: 'places' }).map((x) => x.id), [m.id]);

  // With a picture model that can see, the photo goes along.
  app.settings.update({ routes: { vision: { providerId: 'p', model: 'llava:13b' } } });
  book.requestCaption(m.id);
  app.script.push(text('CAPTION: Golden hour on the boardwalk, your shadow next to mine.\nPLACE: none\nUS: no'));
  await worker.tick();
  const req2 = app.requests.at(-1)!;
  assert.equal(req2.model, 'llava:13b');
  assert.equal((req2.messages.at(-1) as { images?: { mime: string }[] }).images?.[0].mime, 'image/png');
  assert.equal(book.get(m.id)!.caption, 'Golden hour on the boardwalk, your shadow next to mine.');
  assert.equal(book.get(m.id)!.place, 'Santa Monica pier', 'an empty place keeps the earlier one');

  // The owner's own words win and are marked as edited.
  assert.equal(book.setCaption(m.id, '  "Our pier."  ')!.caption, 'Our pier.');
  assert.equal(book.get(m.id)!.captionState, 'edited');

  // A model that fails three times marks it failed (the owner can ask again).
  book.requestCaption(m.id);
  for (let i = 0; i < 3; i++) {
    app.script.push(text(''));
    await worker.tick();
  }
  assert.equal(book.get(m.id)!.captionState, 'failed');
});

test('captions: the minors block (nothing sent to the model, no caption kept) and Adult mode rules', async (t) => {
  const { app, book, worker } = setup(t);
  const c = app.store.createConversation({});
  app.store.addMessage(c.id, 'user', 'a sexy photo of a 12 year old', { images: [fakeImg(1)] });
  const before = app.requests.length;
  await worker.tick();
  const m = book.list({ adultOk: true })[0];
  assert.equal(m.captionState, 'blocked');
  assert.equal(m.caption, '');
  assert.equal(app.requests.length, before, 'no model call');

  // The model's caption is checked too.
  const c2 = app.store.createConversation({});
  app.store.addMessage(c2.id, 'user', 'Lunch at the cafe', { images: [fakeImg(2)] });
  app.script.push(text('CAPTION: You looked like a sexy schoolgirl, 14 years old.\nPLACE: none\nUS: no'));
  await worker.tick();
  const m2 = book.list({ adultOk: true }).find((x) => x.image === fakeImg(2))!;
  assert.equal(m2.captionState, 'blocked');
  assert.equal(m2.caption, '');
  assert.throws(() => book.setCaption(m2.id, 'a naked 12 year old'), /can’t be saved/);

  // Explicit captions while Adult mode is off: dropped, and the item counts as adults-only (hidden).
  // (A conversation of its own: the lines above would block any caption in that one.)
  const c3 = app.store.createConversation({});
  app.store.addMessage(c3.id, 'user', 'Hotel night', { images: [fakeImg(3)] });
  app.script.push(text('CAPTION: That night you saw me naked against the window.\nPLACE: none\nUS: yes'));
  await worker.tick();
  const m3 = book.get(book.list({ adultOk: true }).find((x) => x.image === fakeImg(3))!.id)!;
  assert.equal(m3.caption, '', JSON.stringify(m3));
  assert.equal(m3.adult, true, JSON.stringify(m3));
  assert.equal(book.list({ adultOk: false }).some((x) => x.id === m3.id), false);
});

test('HTTP: settings, captions, albums and covers, remove vs delete everywhere, on this day; hidden from the demo, API keys and phone apps', async (t) => {
  const { app, book, clock, closers } = setup(t, new Date('2026-10-28T18:00:00Z'));
  const { j, base, auth } = await serve(app, closers);
  const c = app.store.createConversation({ title: 'Trip' });
  const photo = app.uploads!.save(PNG).id;
  // A photo from exactly a year ago, and one from today.
  clock.now = new Date('2025-10-28T12:00:00Z');
  const old = app.store.addMessage(c.id, 'user', 'Lisbon tram!', { images: [photo] });
  clock.now = new Date('2026-10-28T18:00:00Z');
  app.store.addMessage(c.id, 'assistant', 'Me today', { images: [fakeImg(9)] });

  assert.equal((await j('PUT', '/moments/settings', { mode: 'nope' })).status, 400);
  assert.equal((await j('PUT', '/moments/settings', { mode: 'pinned' })).body.mode, 'pinned');
  assert.equal(app.settings.get().moments?.mode, 'pinned');
  await j('PUT', '/moments/settings', { mode: 'all' });
  await app.momentsWorker!.work;
  book.sync(app.store, 'all');
  let d = (await j('GET', '/moments')).body;
  assert.equal(d.items.length, 2);
  assert.equal(d.settings.mode, 'all');
  assert.equal(d.captioner.billing, 'api');
  assert.deepEqual(d.albums.map((a: { id: string }) => a.id), ['us', 'places', 'looks']);
  assert.equal(d.onThisDay.kind, 'year');
  const oldItem = d.items.find((m: { messageId: number }) => m.messageId === old.id);
  assert.deepEqual(d.onThisDay.ids, [oldItem.id]);
  const today = (await j('GET', '/today')).body;
  assert.equal(today.onThisDay.kind, 'year');
  assert.equal(today.onThisDay.items[0].image, photo);

  // Caption edits and "write a new one".
  assert.equal((await j('PATCH', `/moments/${oldItem.id}`, { caption: 'The yellow tram.' })).body.captionState, 'edited');
  assert.equal((await j('POST', `/moments/${oldItem.id}/caption`, {})).body.captionState, 'pending');

  // Albums: create, add, cover, rename, delete (photos stay).
  const al = (await j('POST', '/moments/albums', { name: '  Lisbon  ' })).body;
  assert.equal(al.name, 'Lisbon');
  assert.equal((await j('POST', '/moments/albums', { name: ' ' })).status, 400);
  assert.equal((await j('POST', `/moments/albums/${al.id}/items`, { ids: [oldItem.id] })).body.added, 1);
  assert.equal((await j('PATCH', `/moments/albums/${al.id}`, { cover: oldItem.id, name: 'Lisboa' })).status, 200);
  d = (await j('GET', `/moments?album=${al.id}`)).body;
  assert.deepEqual(d.items.map((m: { id: number }) => m.id), [oldItem.id]);
  const card = d.albums.find((a: { id: string }) => a.id === al.id);
  assert.equal(card.name, 'Lisboa');
  assert.equal(card.cover, photo);
  assert.equal((await j('PATCH', '/moments/albums/looks', { cover: d.items[0].id })).status, 200);
  assert.equal((await j('PATCH', '/moments/albums/us', { name: 'x' })).status, 400);
  assert.equal((await j('DELETE', '/moments/albums/us')).status, 400);
  assert.equal((await j('DELETE', `/moments/albums/${al.id}/items/${oldItem.id}`)).status, 200);
  assert.equal((await j('DELETE', `/moments/albums/${al.id}`)).status, 200);
  assert.equal((await j('GET', '/moments')).body.items.length, 2, 'deleting an album keeps its photos');

  // Partner chats can't be added by hand.
  const pc = app.store.createConversation({ channel: 'telegram', partner: 'Sam' });
  const pm = app.store.addMessage(pc.id, 'user', 'x', { images: [fakeImg(5)] });
  assert.equal((await j('POST', '/moments', { messageId: pm.id })).status, 400);

  // Remove from moments: the message keeps its photo.
  assert.equal((await j('DELETE', `/moments/${oldItem.id}`)).status, 200);
  assert.deepEqual(app.store.messageById(old.id)!.meta!.images, [photo]);
  assert.ok(existsSync(join(app.dataDir, 'uploads', photo)));
  // Delete everywhere asks first, then takes it out of the message (words stay) and deletes the file.
  assert.equal((await j('POST', `/moments/${oldItem.id}/delete-everywhere`, {})).status, 400);
  const del = await j('POST', `/moments/${oldItem.id}/delete-everywhere`, { confirm: true });
  assert.equal(del.body.messages, 1);
  assert.deepEqual(app.store.messageById(old.id)!.meta!.images, []);
  assert.equal(app.store.messageById(old.id)!.content, 'Lisbon tram!');
  assert.equal(existsSync(join(app.dataDir, 'uploads', photo)), false);

  // Adults-only items: hidden while Adult mode is off and in the phone apps.
  const adult = app.store.addMessage(c.id, 'user', 'fuck yes, naked in the hotel bed', { images: [fakeImg(11)] });
  book.sync(app.store, 'all');
  assert.equal((await j('GET', '/moments')).body.items.some((m: { messageId: number }) => m.messageId === adult.id), false);
  app.settings.update({ adultMode: { on: true, confirmedAt: clock.now.toISOString() } });
  assert.equal((await j('GET', '/moments')).body.items.some((m: { messageId: number }) => m.messageId === adult.id), true);
  const phone = (await j('GET', '/moments', undefined, { authorization: `Bearer ${auth.newToken}`, 'user-agent': 'Mozilla/5.0 SaraPhone/3' })).body;
  assert.equal(phone.items.some((m: { messageId: number }) => m.messageId === adult.id), false);
  assert.equal(phone.hiddenAdult, 1);

  // An API key (other apps) can't reach the album; MCP lists no album tool.
  const key = auth.createApiKey('Other app').token;
  assert.equal((await j('GET', '/moments', undefined, { authorization: `Bearer ${key}` })).status, 401);
  const list = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}`, 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const names = ((await list.json()) as { result: { tools: { name: string; description: string }[] } }).result.tools;
  assert.ok(names.length > 3);
  assert.equal(names.some((x) => /moment|album|photo/i.test(`${x.name} ${x.description}`)), false);
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}`, 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} }) });
  assert.doesNotMatch(await res.text(), /moment|album/i);
});

test('demo server: the album is refused and Today has no "On this day"', async (t) => {
  const { app, book, closers } = setup(t);
  const c = app.store.createConversation({});
  app.store.addMessage(c.id, 'user', 'x', { images: [fakeImg(1)] });
  book.sync(app.store, 'all');
  const { j } = await serve(app, closers, { demo: true });
  assert.equal((await j('GET', '/moments')).status, 403);
  assert.equal((await j('PUT', '/moments/settings', { mode: 'off' })).status, 403);
  assert.equal((await j('POST', '/moments/albums', { name: 'x' })).status, 403);
  const today = await j('GET', '/today');
  assert.equal(today.status, 200);
  assert.equal(today.body.onThisDay, undefined);
});

test('her tool: brings up a moment with its photo; once a day unprompted; never in group chats, work channels, partner chats or other apps\' turns', async (t) => {
  const { app, book, clock } = setup(t);
  const c = app.store.createConversation({});
  const photo = app.uploads!.save(PNG).id;
  app.store.addMessage(c.id, 'user', 'At the lake', { images: [photo] });
  book.sync(app.store, 'all');
  const m = book.list({ adultOk: true })[0];
  book.saveCaption(m.id, { caption: 'The lake that swallowed your sandal.' });
  const tool = createMomentsTool(() => app, book);
  app.store.addMessage(c.id, 'user', 'what a long week');
  assert.match(await tool.run({ action: 'find', query: 'lake' }, ctxFor(c.id)), new RegExp(`#${m.id} .*sandal`));
  const attached: string[] = [];
  assert.match(await tool.run({ action: 'show', id: m.id }, ctxFor(c.id, attached)), /sandal/);
  assert.deepEqual(attached, [photo]);
  await assert.rejects(tool.run({ action: 'show', id: m.id }, ctxFor(c.id)), /already brought up a moment today/);
  // Asked about photos: fine.
  app.store.addMessage(c.id, 'user', 'do you remember that photo from the lake?');
  assert.match(await tool.run({ action: 'show', id: m.id }, ctxFor(c.id)), /sandal/);
  // The next day it may come up unprompted again.
  app.store.addMessage(c.id, 'user', 'morning');
  clock.now = new Date(clock.now.getTime() + 86_400_000);
  assert.match(await tool.run({ action: 'show', id: m.id }, ctxFor(c.id)), /sandal/);
  // Channels where the album stays out.
  for (const opts of [{ channel: 'group' }, { channel: 'discord-work' }, { channel: 'telegram', partner: 'Sam' }, { channel: 'mcp' }, { channel: 'api' }]) {
    const other = app.store.createConversation(opts);
    await assert.rejects(tool.run({ action: 'find', query: '' }, ctxFor(other.id)), /stays out|only for your conversations/);
  }
  // Items added by hand from a private conversation stay out of ordinary conversations.
  const priv = app.store.createConversation({ private: true });
  const pm = app.store.addMessage(priv.id, 'user', 'secret garden', { images: [fakeImg(4)] });
  book.addByHand(app.store, pm.id);
  assert.doesNotMatch(await tool.run({ action: 'find', query: '' }, ctxFor(c.id)), /secret garden/);
  assert.match(await tool.run({ action: 'find', query: 'garden' }, ctxFor(priv.id)), /secret garden/);

  // The turn engine leaves the tool out of work channels and other apps' turns.
  const toolNames = () => (app.requests.at(-1)!.tools ?? []).map((x) => x.name);
  app.script.push(text('ok'));
  for await (const _ of runTurn(app, c.id, 'hi')) void _;
  assert.ok(toolNames().includes('moments'));
  const work = app.store.createConversation({ channel: 'discord-work' });
  app.script.push(text('ok'));
  for await (const _ of runTurn(app, work.id, 'hi')) void _;
  assert.equal(toolNames().includes('moments'), false);
  assert.ok(toolNames().includes('scrapbook'));
  const api = app.store.createConversation({ channel: 'api' });
  app.script.push(text('ok'));
  for await (const _ of runTurn(app, api.id, 'hi', undefined, { externalApp: true })) void _;
  assert.equal(toolNames().includes('moments'), false);
});

test('captions: parsing and cleaning', () => {
  assert.deepEqual(parseCaptionAnswer('CAPTION: Hi there.\nPLACE: none\nUS: no'), { caption: 'Hi there.', place: '', us: false });
  assert.deepEqual(parseCaptionAnswer('<think>hmm</think>**CAPTION:** “The café.”\n**PLACE:** Café Luna.\n**US:** Yes'), { caption: 'The café.', place: 'Café Luna', us: true });
  assert.equal(parseCaptionAnswer('Just a caption without labels').caption, 'Just a caption without labels');
  assert.ok(cleanCaption('x '.repeat(300)).length <= 240);
});
