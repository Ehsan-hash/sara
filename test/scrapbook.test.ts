// Phase 9: scrapbook (pins, jokes, photos, Sara's tool, no partner chats).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { runTurn } from '../src/chat.ts';
import { createScrapbookTool } from '../src/scrapbook.ts';
import { createSaraServer } from '../src/server.ts';
import { call, makeApp, ROOT, tempDir, text } from './helpers.ts';

test('scrapbook: pin a message, add a joke, photos collected, Sara adds and recalls; partner chats excluded', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex' });
  app.tools.add(createScrapbookTool(app.scrapbook!));
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const j = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };

  const conv = app.store.createConversation({});
  const msg = app.store.addMessage(conv.id, 'assistant', 'The great pancake incident of October.');
  const pin = await j('POST', '/scrapbook', { messageId: msg.id });
  assert.equal(pin.status, 201);
  assert.equal(pin.body.text, 'The great pancake incident of October.');
  assert.equal((await j('POST', '/scrapbook', { messageId: msg.id })).body.id, pin.body.id, 'pinning twice keeps one entry');
  await j('POST', '/scrapbook', { kind: 'joke', text: 'Never trust a waffle.' });

  const partner = app.store.createConversation({ channel: 'telegram', partner: 'Alex' });
  const pm = app.store.addMessage(partner.id, 'user', 'hi from Alex');
  assert.equal((await j('POST', '/scrapbook', { messageId: pm.id })).status, 400, "other people's chats stay out");

  app.store.addMessage(conv.id, 'user', '(photo)', { images: ['0'.repeat(32) + '.jpg'] });
  const book = (await j('GET', '/scrapbook')).body;
  assert.deepEqual(book.entries.map((e: { kind: string }) => e.kind).sort(), ['joke', 'moment']);
  assert.equal(book.photos.length, 1);
  assert.equal(book.photos[0].from, 'owner');

  // Sara adds an inside joke and later looks back.
  app.script.push([call('s1', 'scrapbook', { action: 'add', kind: 'joke', text: 'The cat is the real boss.' })], text('Saved that one.'));
  for await (const _ of runTurn(app, conv.id, 'haha the cat runs this house')) void _;
  app.script.push([call('s2', 'scrapbook', { action: 'list' })], text('Remember the waffle thing?'));
  for await (const _ of runTurn(app, conv.id, 'what are our inside jokes?')) void _;
  const listed = app.store.messages(conv.id).filter((m) => m.role === 'tool').at(-1)!.content;
  assert.match(listed, /Never trust a waffle/);
  assert.match(listed, /The cat is the real boss\. *$/m);
  assert.match(listed, /added by you/);
});
