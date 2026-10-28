// Phase 3.8: export (secrets scrubbed) and import (merge, remapped ids, memories keep sources).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { runTurn } from '../src/chat.ts';
import { exportAll, importAll } from '../src/export.ts';
import { summarizeConversation } from '../src/memory-worker.ts';
import { createSaraServer } from '../src/server.ts';
import { call, makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';

function mk(t: { after: (fn: () => void) => void }): TestApp {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm' });
  return app;
}

async function drain(app: TestApp, id: string, msg: string) {
  for await (const _ of runTurn(app, id, msg));
}

test('export scrubs secrets; import into a fresh server restores chats, memories (with sources), planner', async (t) => {
  const a = mk(t);
  a.settings.update({ ownerName: 'Alex', timeZone: 'America/Chicago' });
  a.vault.set('provider:openai', 'sk-proj-EXPORTLEAKCHECK1234567890');
  const conv = a.store.createConversation({ title: 'Pets' });
  a.script.push(text('Cute!'));
  await drain(a, conv.id, 'My cat is Pixel. Also my key is sk-proj-EXPORTLEAKCHECK1234567890 oops');
  const uid = a.store.messages(conv.id).find((m) => m.role === 'user')!.id;
  a.script.push(text(JSON.stringify({ summary: 'Alex told Sara about Pixel.', facts: [{ fact: "Alex's cat is Pixel.", message_id: uid, quote: 'My cat is Pixel' }] })));
  await summarizeConversation(a, a.memory!, conv.id);
  a.script.push([call('t', 'todo', { action: 'add', title: 'Buy cat food', project: 'Home' }), call('r', 'remind', { action: 'set', text: 'feed Pixel', when: 'tomorrow 8am', repeat: 'daily' })], text('Done.'));
  await drain(a, conv.id, 'add cat food and remind me daily to feed Pixel');
  a.planner!.saveNote({ title: 'Vet', body: 'Dr. Lee, Tuesdays' });

  const file = exportAll(a);
  const blob = JSON.stringify(file);
  assert.ok(!blob.includes('EXPORTLEAKCHECK'), 'vault secret scrubbed from the export');
  assert.match(blob, /my key is \[REDACTED\] oops/);
  assert.equal(file.conversations[0].messages.length > 3, true);

  const b = mk(t);
  // Make ids differ on the target so remapping matters.
  const other = b.store.createConversation({ title: 'Existing' });
  b.store.addMessage(other.id, 'user', 'hello');
  b.store.addMessage(other.id, 'assistant', 'hi');
  const r = importAll(b, JSON.parse(blob));
  assert.equal(r.conversations, 1);
  assert.equal(r.memories, 2);
  assert.equal(r.tasks, 1);
  assert.equal(r.reminders, 1);
  assert.equal(r.notes, 1);
  assert.equal(r.projects, 1);
  assert.equal(b.settings.get().ownerName, 'Alex');
  const fact = b.memory!.list({ kind: 'fact' })[0];
  const src = b.store.messages(conv.id).find((m) => m.id === fact.sourceMessageId);
  assert.match(src?.content ?? '', /My cat is Pixel/, 'fact still points at its source turn after id remapping');
  assert.equal(b.memory!.state(conv.id).summarizedThrough >= fact.sourceMessageId!, true);
  assert.equal(b.memory!.list({ q: 'pixel' }).length, 2, 'FTS index populated on import');
  assert.equal(b.planner!.tasks()[0].project, 'Home');
  assert.equal(b.planner!.reminders()[0].conversationId, conv.id);
  assert.equal(b.planner!.notes('vet')[0].body, 'Dr. Lee, Tuesdays');

  // Importing the same file again does not duplicate conversations or their memories.
  const again = importAll(b, JSON.parse(blob));
  assert.equal(again.conversations, 0);
  assert.equal(again.skippedConversations, 1);
  assert.equal(again.memories, 0);

  assert.throws(() => importAll(b, { format: 'nope' }), /Not a Sara export/);
  assert.throws(() => importAll(b, { format: 'sara-export', version: 99 }), /newer/);
});

test('export/import API', async (t) => {
  const app = mk(t);
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  app.store.createConversation({ title: 'One' });
  const res = await fetch(`${base}/export`, { headers: H });
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="sara-export-2026-10-24\.json"/);
  const file = await res.json();
  assert.equal(file.format, 'sara-export');
  const imp = await fetch(`${base}/import`, { method: 'POST', headers: H, body: JSON.stringify(file) });
  assert.equal((await imp.json()).skippedConversations, 1);
  const bad = await fetch(`${base}/import`, { method: 'POST', headers: H, body: '{"format":"x"}' });
  assert.equal(bad.status, 400);
});
