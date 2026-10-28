// Phase 9: pictures from Sara (share_photo / take_photo).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { runTurn, historyFrom } from '../src/chat.ts';
import { createPhotoTools, PHOTO_KEY_VAULT } from '../src/photos.ts';
import { call, makeApp, ROOT, tempDir, text } from './helpers.ts';

test('share_photo attaches her portrait to the reply; take_photo uses xAI from her look; never minors', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', photos: { mode: 'new' } });
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const fakeFetch = async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
  };
  for (const tool of createPhotoTools({ webDir: join(ROOT, 'web'), uploads: app.uploads!, settings: app.settings, vault: app.vault, xaiProviderKey: () => undefined, customPortrait: () => undefined, persona: () => app.persona, fetch: fakeFetch as never })) app.tools.add(tool);
  assert.equal(app.tools.permission('share_photo', {}), 'auto');
  assert.equal(app.tools.permission('take_photo', {}), 'ask', 'costs money: asks');
  assert.ok(!app.tools.enabled({}).some((x) => x.spec.name === 'take_photo'), 'hidden without an xAI key');
  app.vault.set(PHOTO_KEY_VAULT, 'xai-test');

  const conv = app.store.createConversation({});
  app.script.push([call('c1', 'share_photo', { picture: 'happy' })], text('Here I am, laughing at your joke.'));
  for await (const _ of runTurn(app, conv.id, 'send me a pic?')) void _;
  const reply = app.store.messages(conv.id).findLast((m) => m.role === 'assistant')!;
  assert.equal(reply.content, 'Here I am, laughing at your joke.');
  const ids = reply.meta?.images as string[];
  assert.equal(ids.length, 1);
  assert.ok(app.uploads!.get(ids[0]), 'stored like other photos');
  assert.match(historyFrom(app.store.messages(conv.id)).at(-1)!.content, /\[You sent 1 photo with this message\.\]/, 'she remembers sending it');

  // take_photo (approved in settings): edit request with her portrait as the reference.
  app.settings.update({ toolPermissions: { take_photo: 'auto' } });
  app.script.push([call('c2', 'take_photo', { scene: 'selfie at the farmers market with sunflowers' })], text('Just took this!'));
  const evs: string[] = [];
  for await (const ev of runTurn(app, conv.id, 'what are you up to?')) evs.push(ev.type);
  assert.ok(evs.includes('image'), 'the picture shows up live');
  assert.equal(sent[0].url, 'https://api.x.ai/v1/images/edits');
  assert.match(String((sent[0].body.image as { url: string }).url), /^data:image\/jpeg;base64,/);
  assert.match(String(sent[0].body.prompt), /same person \(a woman in her late 20s.*farmers market.*She is an adult\./s);
  const last = app.store.messages(conv.id).findLast((m) => m.role === 'assistant')!;
  assert.equal((last.meta?.images as string[]).length, 1);

  // Never minors.
  app.script.push([call('c3', 'take_photo', { scene: 'photo with a school girl' })], text('Ok.'));
  for await (const _ of runTurn(app, conv.id, 'one more')) void _;
  const tool = app.store.messages(conv.id).findLast((m) => m.role === 'tool')!;
  assert.match(tool.content, /never involve children/);
  assert.equal(sent.length, 1, 'no request was made');
});
