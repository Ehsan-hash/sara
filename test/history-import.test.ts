// Phase 51: bring your history. ChatGPT and Claude exports are read (shown branch only, tools and
// hidden nodes left out), previewed, imported as archived past conversations with their original
// times (another assistant's replies marked as theirs), deduped, learned from under the exact-words
// rule (only the owner's own lines), labelled, exported and removed again.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { buildHistory } from '../src/chat.ts';
import { exportAll, importAll } from '../src/export.ts';
import { readExport } from '../src/history-import/index.ts';
import { selectMemories } from '../src/memory.ts';
import { createRecallTool, lastTimeNote } from '../src/recall.ts';
import { createSaraServer } from '../src/server.ts';
import { chatgptConversations, chatgptZip, claudeZip, makeZip } from './history-fixtures.ts';
import { makeApp, ROOT, tempDir, text } from './helpers.ts';

const NOW = new Date('2026-10-27T15:00:00Z');

test('ChatGPT export: the shown branch only; system, tools, reasoning and hidden nodes left out; pictures noted', () => {
  const p = readExport(chatgptZip(6), NOW);
  assert.equal(p.source, 'chatgpt');
  assert.equal(p.conversations.length, 6);
  const c0 = p.conversations[0];
  assert.equal(c0.sourceId, 'chatgpt-conv-0');
  assert.equal(c0.title, 'Sourdough starter help');
  assert.equal(c0.createdAt, '2024-01-05T10:00:00.000Z');
  const texts = c0.messages.map((m) => `${m.role}: ${m.text}`);
  assert.ok(!texts.some((t) => t.includes('regenerated')), 'the regenerated branch is not imported');
  assert.ok(!texts.some((t) => t.includes('search(')), 'tool calls are not imported');
  assert.ok(!texts.some((t) => /\ue200|cite/.test(t)), 'citation markers are removed');
  assert.deepEqual(c0.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.match(c0.messages[0].text, /starter is called Gerald/);
  assert.equal(c0.messages[4].text, 'What bird is this?');
  assert.deepEqual(c0.messages[4].attachments, ['an image']);
  assert.ok(c0.messages.every((m, i) => i === 0 || m.createdAt >= c0.messages[i - 1].createdAt), 'times in order');
  assert.equal(p.skipped.system, 6, 'one hidden system message each');
  assert.ok(p.skipped.tool >= 4 && p.skipped.images === 2 && p.skipped.hidden >= 2, JSON.stringify(p.skipped));
  // Newer exports split the file; a bare conversations.json works too.
  assert.equal(readExport(chatgptZip(7, { split: true }), NOW).conversations.length, 7);
  assert.equal(readExport(Buffer.from(JSON.stringify(chatgptConversations(3))), NOW).conversations.length, 3);
});

test('Claude export: thinking and tool blocks left out, attachments noted, empty conversations skipped', () => {
  const p = readExport(claudeZip(), NOW);
  assert.equal(p.source, 'claude');
  assert.equal(p.conversations.length, 2);
  assert.equal(p.skipped.emptyConversations, 1);
  const [c] = p.conversations;
  assert.equal(c.title, 'Marathon training plan');
  assert.equal(c.messages.length, 4);
  assert.equal(c.messages[1].text, 'A cat with opinions about your training! Here is an 16-week plan.');
  assert.deepEqual(c.messages[2].attachments, ['running-log.csv']);
  assert.equal(c.messages[3].text, 'Done: five days, long run on Sunday.');
  assert.ok(p.skipped.hidden >= 1 && p.skipped.tool === 2 && p.skipped.attachments === 1, JSON.stringify(p.skipped));
});

test('not an export: plain words, no crash', () => {
  assert.throws(() => readExport(makeZip({ 'notes.txt': 'hi' }), NOW), /No conversations\.json/);
  assert.throws(() => readExport(makeZip({ 'conversations.json': '{nope' }), NOW), /isn't valid JSON/);
  assert.throws(() => readExport(makeZip({ 'conversations.json': JSON.stringify([{ foo: 1 }]) }), NOW), /doesn't look like a ChatGPT or Claude export/);
  assert.throws(() => readExport(Buffer.from('PK\u0003\u0004 broken'), NOW), /damaged/);
});

function setup(t: { after: (fn: () => void | Promise<void>) => void }) {
  const { dir, cleanup } = tempDir();
  const clock = { now: NOW };
  const app = makeApp(dir, clock);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'America/Chicago' });
  const auth = new OwnerAuth(dir, () => clock.now);
  const token = auth.newToken!;
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  t.after(async () => {
    app.historyImport?.stop();
    await new Promise<void>((r) => server.close(() => r()));
    app.store.close();
    cleanup();
  });
  const ready = new Promise<string>((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  const call = async (path: string, method = 'GET', body?: unknown, raw?: Buffer) => {
    const base = await ready;
    // One retry when a reused keep-alive socket was closed under load (ECONNRESET on busy servers).
    const send = () => fetch(`${base}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined,
    });
    try {
      return await send();
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code !== 'ECONNRESET') throw err;
      return send();
    }
  };
  return { app, call, clock };
}

test('preview → import: archived past conversations with original times, marked as the other assistant; re-import skips them', async (t) => {
  const { app, call } = setup(t);
  // Something of her own first, so "last time" and "how long we've known each other" can be checked.
  const own = app.store.createConversation({ title: 'Hi' });
  app.store.addMessage(own.id, 'user', 'Morning! Coffee first.');
  app.store.addMessage(own.id, 'assistant', 'Always.');
  const pv = await (await call('/history-import/preview', 'POST', undefined, chatgptZip(12))).json();
  assert.equal(pv.source, 'chatgpt');
  assert.equal(pv.name, 'ChatGPT');
  assert.equal(pv.conversations, 12);
  assert.equal(pv.already, 0);
  assert.ok(pv.messages > 24 && pv.yourMessages >= 12);
  assert.equal(pv.from, '2024-01-05T10:00:00.000Z');
  assert.ok(pv.sampleTitles.length > 0 && pv.skipped.images === 3);
  assert.equal(app.store.importedConversationIds().length, 0, 'nothing imported by the preview');

  const st = await (await call('/history-import/run', 'POST', { id: pv.id, options: { learn: false } })).json();
  assert.equal(st.state, 'done');
  assert.equal(st.imported, 12);
  assert.equal(st.onServer.conversations, 12);
  assert.deepEqual(st.onServer.bySource, { ChatGPT: 12 });
  const ids = app.store.importedConversationIds();
  const c = app.store.getConversation(ids[0])!;
  assert.equal(c.channel, 'import-chatgpt');
  assert.equal(c.channelKey, 'chatgpt-conv-0');
  assert.equal(c.title, 'Sourdough starter help');
  assert.ok(c.archivedAt, 'archived so they do not flood the list');
  assert.equal(c.createdAt, '2024-01-05T10:00:00.000Z');
  const msgs = app.store.messages(c.id);
  assert.equal(msgs[0].createdAt, '2024-01-05T10:00:30.000Z', 'original time kept');
  assert.ok(msgs.every((m) => m.meta?.importedFrom === 'chatgpt'));
  // The list keeps her own conversation first; imported ones never count as "the latest".
  assert.equal(app.store.listConversations()[0].id, own.id);
  assert.equal(app.store.firstOwnerMessageAt()!.toISOString().slice(0, 10), '2026-10-27', 'imported years ago does not mean known for years');
  assert.ok(lastTimeNote(app, 'other', 'Alex')?.includes('"Hi"'), 'last time is still her own conversation');
  // The everyday memory worker leaves them alone (learning is the import's own, rate-limited job).
  assert.deepEqual(app.memory!.dueConversations(new Date(NOW.getTime() + 86_400_000), new Date(NOW.getTime())), [own.id]);
  assert.deepEqual(app.memory!.rollingConversations(1, new Date(NOW.getTime())), [own.id]);
  // In her history, the other assistant's replies are notes, not her own words.
  const hist = buildHistory(msgs).messages;
  assert.equal(hist.filter((m) => m.role === 'assistant').length, 0);
  assert.match(String(hist[1].content), /ChatGPT replied \(not you\)/);

  // Re-import: the same export adds nothing.
  const pv2 = await (await call('/history-import/preview', 'POST', undefined, chatgptZip(12))).json();
  assert.equal(pv2.already, 12);
  const st2 = await (await call('/history-import/run', 'POST', { id: pv2.id, options: { learn: false } })).json();
  assert.equal(st2.imported, 0);
  assert.equal(st2.skippedExisting, 12);
  assert.equal(app.store.importedConversationIds().length, 12);
  // A used preview can't be run twice; junk is a 400.
  assert.equal((await call('/history-import/run', 'POST', { id: pv2.id })).status, 400);
  assert.equal((await call('/history-import/preview', 'POST', undefined, Buffer.from('hello'))).status, 400);

  // Recall finds imported lines and labels them: ChatGPT said it, not her.
  const recall = createRecallTool(() => app);
  const out = String(await recall.run({ query: 'sourdough starter Gerald' }, { conversationId: own.id } as never));
  assert.match(out, /imported ChatGPT history/);
  assert.match(out, /Alex \(to ChatGPT\): My sourdough starter is called Gerald/);
  assert.match(out, /ChatGPT said: Not dead!/);
  assert.ok(!/\n {2}You: Not dead/.test(out), 'never shown as her own words');
  // Claude export next to it.
  const pvc = await (await call('/history-import/preview', 'POST', undefined, claudeZip())).json();
  assert.equal(pvc.name, 'Claude');
  await call('/history-import/run', 'POST', { id: pvc.id, options: { learn: false } });
  const c2 = String(await recall.run({ query: 'marathon Miso shoes' }, { conversationId: own.id } as never));
  assert.match(c2, /Claude said: A cat with opinions/);
});

test('L3: one upload at a time; the export is read once (the preview keeps it); only old leftover uploads are cleared', async (t) => {
  const { app, call } = setup(t);
  const { HistoryImporter } = await import('../src/history-import/index.ts');
  const { existsSync, mkdirSync, utimesSync, writeFileSync } = await import('node:fs');
  const hi = (app.historyImport = new HistoryImporter(() => app));
  // Leftovers: an old *.upload goes, a fresh one (maybe still being written) and other files stay.
  mkdirSync(hi.dir, { recursive: true });
  const old = join(hi.dir, 'old.upload');
  const fresh = join(hi.dir, 'fresh.upload');
  const other = join(hi.dir, 'keep.txt');
  for (const f of [old, fresh, other]) writeFileSync(f, 'x');
  const past = new Date(Date.now() - 3 * 3600_000);
  utimesSync(old, past, past);
  utimesSync(other, past, past);
  const p1 = hi.uploadPath();
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(existsSync(other), true);
  assert.equal(hi.uploading, true);
  assert.throws(() => hi.uploadPath(), /Another history file is being read/);
  assert.equal((await call('/history-import/preview', 'POST', undefined, chatgptZip(2))).status, 409, 'a second upload waits');
  hi.uploadDone(p1);
  // Through the API: the uploaded file is gone right after the preview, and run still works.
  const pv = await (await call('/history-import/preview', 'POST', undefined, chatgptZip(3))).json();
  assert.equal(pv.conversations, 3);
  assert.equal(hi.uploading, false);
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(hi.dir).filter((f) => f.endsWith('.upload')), ['fresh.upload']);
  const done = await (await call('/history-import/run', 'POST', { id: pv.id, options: { learn: false } })).json();
  assert.equal(done.imported, 3);
});

test('learning: rate-limited background job; facts only from the owner own words; labelled; undo removes it all', async (t) => {
  const { app, call } = setup(t);
  const { HistoryImporter } = await import('../src/history-import/index.ts');
  app.historyImport = new HistoryImporter(() => app, { learnGapMs: 0 });
  const pv = await (await call('/history-import/preview', 'POST', undefined, chatgptZip(2))).json();
  // Two conversations to learn from (oldest first). For each, the model tries a fact from the
  // owner's line (kept), one quoting ChatGPT (dropped), and a "Sara said" note (dropped).
  const plan = (convIdx: number) => {
    const id = app.store.importedConversationIds()[convIdx];
    const msgs = app.store.messages(id);
    const user = msgs.find((m) => m.role === 'user')!;
    const bot = msgs.find((m) => m.role === 'assistant')!;
    return JSON.stringify({
      summary: `Alex and Sara talked about ${convIdx ? 'a trip' : 'his sourdough starter'}.`,
      facts: [
        { fact: convIdx ? 'Alex is planning a trip to Lisbon with his sister Ana.' : "Alex's sourdough starter is named Gerald.", message_id: user.id, quote: convIdx ? 'trip to Lisbon in May with my sister Ana' : 'starter is called Gerald' },
        { fact: 'Alex should feed his starter twice a day.', message_id: bot.id, quote: bot.content.slice(0, 30) },
      ],
      sara: [{ fact: 'Sara said Gerald is hungry.', message_id: bot.id, quote: 'Gerald is hungry' }],
      decisions: [{ what: 'They agreed on a relaxed plan.', message_id: bot.id, quote: bot.content.slice(0, 20) }],
    });
  };
  // Imported without learning first, then "Learn from the rest" (oldest first), so the model's
  // answers can name the real message ids.
  const st = await (await call('/history-import/run', 'POST', { id: pv.id, options: { learn: false } })).json();
  assert.equal(st.imported, 2);
  assert.equal(app.memory!.list().length, 0, 'nothing learned with learning off');
  app.script.push(text(plan(0)), text(plan(1)));
  const started = await (await call('/history-import/learn', 'POST', {})).json();
  assert.equal(started.state, 'learning');
  assert.equal(started.learnTotal, 2);
  await app.historyImport!.idle();
  const status = await (await call('/history-import')).json();
  assert.equal(status.state, 'done', JSON.stringify(status));
  assert.equal(status.learned, 2);
  const facts = app.memory!.list({ kind: 'fact' }).map((f) => f.content).sort();
  assert.deepEqual(facts, ["Alex is planning a trip to Lisbon with his sister Ana.", "Alex's sourdough starter is named Gerald."]);
  assert.equal(app.memory!.list({ kind: 'self' }).length, 0, 'ChatGPT lines never become her own');
  assert.equal(app.memory!.list({ kind: 'decision' }).length, 0, 'nor decisions');
  const summaries = app.memory!.list({ kind: 'summary' });
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((s) => /Alex and ChatGPT/.test(s.content) && !/Sara/.test(s.content)), summaries.map((s) => s.content).join(' | '));
  assert.ok(summaries.every((s) => s.happenedOn.startsWith('2024-01')), 'dated when it happened');
  // The prompt told the model whose lines are whose.
  const prompt = String(app.requests.at(-1)!.messages[1].content);
  assert.match(prompt, /ChatGPT \(another AI assistant, not Sara\)/);
  assert.match(prompt, /imported ChatGPT history/);
  // Labelled in her notes and on the Memory page.
  const inj = selectMemories(app.memory!, { userText: 'sourdough Gerald', conversationId: 'x', oldestHistoryId: 0, budgetChars: 4000, importedFrom: (id) => (app.store.getConversation(id)?.channel === 'import-chatgpt' ? 'ChatGPT' : undefined) });
  assert.match(inj.text, /learned from their imported ChatGPT history: that was ChatGPT talking with them, not you\) Alex's sourdough starter is named Gerald/);
  const view = (await (await call('/memories?kind=fact')).json()) as { importedFrom: string | null; content: string }[];
  assert.ok(view.every((m) => m.importedFrom === 'ChatGPT'));

  // Export round trip: the imported conversations, their marks and the notes come back.
  const file = exportAll(app);
  const tmp = tempDir();
  const other = makeApp(tmp.dir, { now: NOW });
  t.after(() => {
    other.store.close();
    tmp.cleanup();
  });
  importAll(other, file);
  const back = other.store.importedConversationIds();
  assert.equal(back.length, 2);
  assert.equal(other.store.getConversation(back[0])!.channel, 'import-chatgpt');
  assert.ok(other.store.messages(back[0]).every((m) => m.meta?.importedFrom === 'chatgpt'));
  assert.equal(other.memory!.list({ kind: 'fact' }).length, 2);

  // Undo: everything imported and learned goes; her own notes stay.
  const mine = app.memory!.add({ kind: 'fact', content: 'Alex likes oat milk.', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-27', evidence: 'You added this.' });
  const r = await (await call('/history-import', 'DELETE')).json();
  assert.equal(r.conversations, 2);
  assert.equal(r.notes, 4);
  assert.equal(app.store.importedConversationIds().length, 0);
  assert.deepEqual(app.memory!.list().map((m) => m.id), [mine.id]);
  assert.equal(r.status.onServer.conversations, 0);
});

test('learning pauses itself when the model keeps failing, and can be stopped', async (t) => {
  const { app, call } = setup(t);
  const { HistoryImporter } = await import('../src/history-import/index.ts');
  app.historyImport = new HistoryImporter(() => app, { learnGapMs: 0 });
  app.settings.update({ defaultProviderId: 'gone' });
  const pv = await (await call('/history-import/preview', 'POST', undefined, chatgptZip(5))).json();
  await call('/history-import/run', 'POST', { id: pv.id, options: { learn: true } });
  await app.historyImport!.idle();
  const st = await (await call('/history-import')).json();
  assert.equal(st.state, 'paused');
  assert.match(st.message, /didn't answer/);
  assert.equal(st.learnTotal, 5);
  const stopped = await (await call('/history-import/cancel', 'POST', {})).json();
  assert.equal(stopped.state, 'done');
  assert.match(stopped.message, /Stopped learning/);
  assert.equal(stopped.onServer.conversations, 5, 'the conversations stay');
});
