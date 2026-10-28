// Phase 32: she remembers across sessions (recall tool, "last time", look-up of what the owner refers to).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTurn } from '../src/chat.ts';
import { autoRecall, createRecallTool, lastTimeNote, parseWhen, recallMessages, topicOf } from '../src/recall.ts';
import { forgetMemory, summarizeConversation } from '../src/memory-worker.ts';
import { selectMemories } from '../src/memory.ts';
import { makeApp, tempDir, text } from './helpers.ts';

const setup = (t: { after: (fn: () => void) => void }, now = '2026-10-25T18:00:00Z') => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date(now) };
  const app = makeApp(dir, clock);
  app.tools.add(createRecallTool(() => app));
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'America/Chicago', disclosureAcceptedAt: clock.now.toISOString() });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  return { app, clock };
};

test('parseWhen: everyday time phrases in the owner\'s time zone', () => {
  const now = new Date('2026-10-25T18:00:00Z'); // Sunday 1 pm in Chicago
  const tz = 'America/Chicago';
  const y = parseWhen('what did we talk about yesterday?', now, tz)!;
  assert.equal(y.label, 'yesterday');
  assert.equal(y.from, '2026-10-24T05:00:00.000Z');
  assert.equal(y.to, '2026-10-25T05:00:00.000Z');
  assert.equal(parseWhen('last Tuesday', now, tz)!.from, '2026-10-20T05:00:00.000Z');
  assert.equal(parseWhen('two weeks ago', now, tz)!.label, 'two weeks ago');
  assert.equal(parseWhen('back in March', now, tz)!.from.slice(0, 7), '2026-03');
  assert.equal(parseWhen('in December', now, tz)!.from.slice(0, 7), '2025-12', 'a later month means last year');
  assert.equal(parseWhen('on 2026-10-01', now, tz)!.label, 'on 2026-10-01');
  assert.equal(parseWhen('hello there', now, tz), undefined);
  assert.equal(parseWhen('what did we talk about on October 2nd?', now, tz)!.from, '2026-10-02T05:00:00.000Z');
  assert.equal(parseWhen('on 14 Feb', now, tz)!.label, 'on February 14');
  assert.equal(parseWhen('Dec 24', now, tz)!.from.slice(0, 10), '2025-12-24', 'a day still ahead means last year');
  assert.equal(parseWhen('I may go', now, tz), undefined, '"may" alone is not a date');
  assert.equal(topicOf('Do you remember the lake trip we talked about last week?'), 'Do you the lake trip about ?');
});

test('the reported bug: a new session knows what happened in the last one (before any summary is written)', async (t) => {
  const { app, clock } = setup(t);
  // Yesterday's session.
  clock.now = new Date('2026-10-24T23:00:00Z');
  const a = app.store.createConversation({ title: 'Weekend plans' });
  app.store.addMessage(a.id, 'user', 'We booked the lake trip with Jenna for June, the cabin by Pine Lake.');
  app.store.addMessage(a.id, 'assistant', 'Yes! Pine Lake in June with Jenna, I can already smell the campfire.');
  app.store.addMessage(a.id, 'user', 'Also I decided to quit coffee for a month.');
  app.store.addMessage(a.id, 'assistant', 'Bold. I give it four days, but I am rooting for you.');
  // Something with the same words in a chat with another person must never come back.
  const other = app.store.createConversation({ title: 'Bob', partner: 'Bob' });
  app.store.addMessage(other.id, 'user', 'Bob here: my secret lake trip plan.');
  // Today, a brand-new conversation.
  clock.now = new Date('2026-10-25T18:00:00Z');
  const b = app.store.createConversation();
  app.script.push(text('Of course, Pine Lake!'));
  for await (const _ of runTurn(app, b.id, 'Do you remember the trip we planned yesterday?')) void _;
  const sys = String(app.requests.at(-1)!.messages[0].content);
  // "Last time": the end of yesterday's conversation, word for word.
  assert.match(sys, /### Last time\nYour last conversation with Alex was "Weekend plans"/);
  assert.match(sys, /Alex: Also I decided to quit coffee for a month\./);
  // Looked up: the passage about the trip.
  assert.match(sys, /### Looked up just now in your past conversations[\s\S]*cabin by Pine Lake/);
  assert.doesNotMatch(sys, /Bob here/);
  // The rule that made her deny it is gone; the new one says look it up and don't deny.
  assert.doesNotMatch(sys, /you don't know it/);
  assert.match(sys, /look it up with the recall tool before answering/);
  assert.match(sys, /don't deny it happened/);
});

test('recall tool: by words (any form), by time, skipping chats with others and forgotten messages', async (t) => {
  const { app, clock } = setup(t);
  clock.now = new Date('2026-10-20T15:00:00Z');
  const a = app.store.createConversation({ title: 'Job stuff' });
  app.store.addMessage(a.id, 'user', 'The interview at Acme went great, they want a second round.');
  app.store.addMessage(a.id, 'assistant', 'Alex! That is huge. When is round two?');
  const f = app.store.addMessage(a.id, 'user', 'Please forget this: my bank PIN hint.');
  app.store.updateMessageMeta(f.id, { forgotten: true });
  clock.now = new Date('2026-10-25T18:00:00Z');
  const now = app.store.createConversation();
  const tool = createRecallTool(() => app);
  const ctx = { workspaceDir: '', signal: new AbortController().signal, sandbox: app.sandbox, conversationId: now.id };
  const byWords = await tool.run({ query: 'interviewing acme' }, ctx);
  assert.match(byWords, /Tue, Oct 20, 2026.*in "Job stuff":\n {2}Alex: The interview at Acme went great/);
  assert.match(byWords, /You: Alex! That is huge/);
  const byTime = await tool.run({ when: 'last Tuesday' }, ctx);
  assert.match(byTime, /second round/);
  assert.doesNotMatch(byTime, /PIN/);
  const wrongTime = await tool.run({ query: 'acme', when: 'yesterday' }, ctx);
  assert.match(wrongTime, /Nothing with those words yesterday; these are from other times:/);
  const none = await tool.run({ query: 'volcano' }, ctx);
  assert.match(none, /Nothing found for “volcano”[\s\S]*If Alex says it happened, believe them/);
  await assert.rejects(tool.run({}, ctx), /Give words to look for, a time, or both/);
  // The search never returns messages already in the conversation she's in.
  app.store.addMessage(now.id, 'user', 'acme acme acme');
  assert.ok(recallMessages(app.store, { query: 'acme', exclude: { conversationId: now.id, fromId: 0 } }).every((h) => h.conversationId === a.id));
});

test('look-up only happens when the owner refers to the past', (t) => {
  const { app } = setup(t);
  const a = app.store.createConversation({ title: 'Garden' });
  app.store.addMessage(a.id, 'user', 'The tomatoes finally came in.');
  const b = app.store.createConversation();
  const ex = { conversationId: b.id, fromId: 0 };
  assert.equal(autoRecall(app, 'How are the tomatoes looking for you?', ex, 'Alex'), undefined, 'no cue, no look-up');
  assert.match(autoRecall(app, 'Remember the tomatoes?', ex, 'Alex')!, /tomatoes finally came in/);
  assert.match(autoRecall(app, 'Remember the pirate costume party?', ex, 'Alex')!, /found nothing about it[\s\S]*don't deny it/);
});

test('memory is written as she goes: long conversations count as due before they go quiet', (t) => {
  const { app } = setup(t);
  const a = app.store.createConversation();
  for (let i = 0; i < 20; i++) {
    app.store.addMessage(a.id, 'user', `message ${i}`);
    app.store.addMessage(a.id, 'assistant', `reply ${i}`);
  }
  const retry = new Date(Date.now() - 3600_000);
  assert.deepEqual(app.memory!.rollingConversations(40, retry), [a.id]);
  app.memory!.setState(a.id, { summarizedThrough: app.store.messages(a.id).at(-1)!.id });
  assert.deepEqual(app.memory!.rollingConversations(40, retry), []);
});

test('decisions, promises and milestones: pulled from the words actually said, followed up, and kept', async (t) => {
  const { app } = setup(t);
  const a = app.store.createConversation({ title: 'Plans' });
  const m1 = app.store.addMessage(a.id, 'user', "Let's do Sunday dinners at my place from now on.");
  const m2 = app.store.addMessage(a.id, 'assistant', "Deal. I'll check in on Thursday after your interview, promise.");
  const m3 = app.store.addMessage(a.id, 'user', 'I got the job!! First real dev job.');
  app.script.push(
    text(
      JSON.stringify({
        summary: 'Alex and Sara made plans.',
        facts: [],
        sara: [],
        dates: [],
        decisions: [
          { what: 'Alex and Sara agreed on Sunday dinners at his place.', message_id: m1.id, quote: 'Sunday dinners at my place' },
          { what: 'Made up: they agreed to move to Mars.', message_id: m1.id, quote: 'move to Mars' },
        ],
        promises: [
          { who: 'sara', what: 'Sara will check in Thursday after the interview.', due: '2026-10-29', message_id: m2.id, quote: "I'll check in on Thursday" },
          { who: 'owner', what: 'Alex will check in (wrong speaker).', message_id: m2.id, quote: "I'll check in on Thursday" },
        ],
        milestones: [{ what: 'Alex got his first real dev job.', message_id: m3.id, quote: 'I got the job' }],
        kept: [],
      }),
    ),
  );
  const r = await summarizeConversation(app, app.memory!, a.id);
  assert.equal(r.error, undefined);
  const mem = app.memory!;
  assert.deepEqual(mem.list({ kind: 'decision' }).map((m) => m.content), ['Alex and Sara agreed on Sunday dinners at his place.'], 'an invented quote is dropped');
  const open = mem.openPromises();
  assert.deepEqual(open.map((m) => [m.content, m.onDate]), [['Sara will check in Thursday after the interview.', '2026-10-29']], 'the wrong speaker is dropped');
  assert.equal(mem.list({ kind: 'milestone' }).length, 1);
  // In a new conversation they're in her notes, tagged so she acts on them.
  const b = app.store.createConversation();
  const inj = selectMemories(mem, { userText: 'hey', conversationId: b.id, oldestHistoryId: 0, budgetChars: 3000 });
  assert.match(inj.text, /decided together: go by it unless told otherwise\) Alex and Sara agreed on Sunday dinners/);
  assert.match(inj.text, /a promise still open, due 2026-10-29: follow up on it\) Sara will check in Thursday/);
  // Kept later: the next summary says so (with the words that show it), and it leaves her notes.
  const m4 = app.store.addMessage(a.id, 'assistant', 'Checking in like I said: how did the interview go?');
  app.store.addMessage(a.id, 'user', 'It went fine, thanks for asking!');
  app.script.push(text(JSON.stringify({ summary: 'Sara checked in.', facts: [], sara: [], dates: [], decisions: [], promises: [], milestones: [], kept: [{ promise: open[0].id, message_id: m4.id, quote: 'Checking in like I said' }] })));
  await summarizeConversation(app, mem, a.id);
  assert.equal(mem.openPromises().length, 0);
  assert.ok(mem.get(open[0].id)!.resolvedAt);
  assert.doesNotMatch(selectMemories(mem, { userText: 'hey', conversationId: b.id, oldestHistoryId: 0, budgetChars: 3000 }).text, /check in Thursday/);
  // The summary prompt lists open promises with their numbers.
  assert.match(String(app.requests.at(-1)!.messages[1].content), new RegExp(`Open promises:\\n${open[0].id}\\. Sara will check in Thursday`));
});

test('upkeep: a change replaces the old note (moved cities), checked against the words said', async (t) => {
  const { app } = setup(t);
  const mem = app.memory!;
  const old = mem.add({ kind: 'fact', content: 'Alex lives in Austin.', conversationId: null, sourceMessageId: null, happenedOn: '2026-01-10' });
  const keep = mem.add({ kind: 'fact', content: 'Alex has a dog named Biscuit.', conversationId: null, sourceMessageId: null, happenedOn: '2026-01-10' });
  const a = app.store.createConversation();
  const m1 = app.store.addMessage(a.id, 'user', 'Big change: we moved from Austin to Denver last weekend, Biscuit loves the snow.');
  app.script.push(text(JSON.stringify({ summary: 'Alex moved.', facts: [{ fact: 'Alex lives in Denver.', message_id: m1.id, quote: 'moved from Austin to Denver' }], sara: [], dates: [], decisions: [], promises: [], milestones: [], kept: [], outdated: [{ note: old.id, message_id: m1.id, quote: 'moved from Austin to Denver' }, { note: keep.id, message_id: m1.id, quote: 'not in the message' }] })));
  await summarizeConversation(app, mem, a.id);
  // The summary prompt listed the related earlier notes with their numbers.
  assert.match(String(app.requests.at(-1)!.messages[1].content), new RegExp(`Earlier notes:[\\s\\S]*${old.id}\\. Alex lives in Austin\\.`));
  assert.ok(mem.get(old.id)!.supersededBy, 'Austin replaced');
  assert.equal(mem.get(keep.id)!.supersededBy, null, 'a made-up quote changes nothing');
  const inj = selectMemories(mem, { userText: 'where do I live', conversationId: 'x', oldestHistoryId: 0, budgetChars: 3000 });
  assert.match(inj.text, /Alex lives in Denver/);
  assert.doesNotMatch(inj.text, /Austin/);
});

test('fading: old notes come to mind only when something brings them up; promises never fade', (t) => {
  const { app } = setup(t);
  const mem = app.memory!;
  mem.add({ kind: 'fact', content: 'Alex played trumpet in high school.', conversationId: null, sourceMessageId: null, happenedOn: '2025-01-05' });
  mem.add({ kind: 'fact', content: 'Alex started a new job at Acme.', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-20' });
  mem.add({ kind: 'promise', content: 'Alex will call his mom.', conversationId: null, sourceMessageId: null, happenedOn: '2025-01-05' });
  const pick = (text: string, fadeDays: number) => selectMemories(mem, { userText: text, conversationId: 'x', oldestHistoryId: 0, budgetChars: 3000, fadeDays, today: '2026-10-25' }).text;
  assert.match(pick('hello', 0), /trumpet/, 'never fade: everything comes to mind');
  assert.doesNotMatch(pick('hello', 120), /trumpet/, 'faded');
  assert.match(pick('hello', 120), /new job at Acme/);
  assert.match(pick('I picked up the trumpet again', 120), /trumpet/, 'brought back when it comes up');
  assert.match(pick('hello', 120), /call his mom/, 'promises never fade');
});

test('forget means forget: later messages that repeat it are hidden too, so "last time" and looking back never bring it back', (t) => {
  const { app } = setup(t);
  const mem = app.memory!;
  const a = app.store.createConversation({ title: 'Dog' });
  const src = app.store.addMessage(a.id, 'user', 'My beagle Biscuit howled all night again.');
  const fact = mem.add({ kind: 'fact', content: 'Alex has a beagle named Biscuit.', conversationId: a.id, sourceMessageId: src.id, happenedOn: '2026-10-20', evidence: 'My beagle Biscuit' });
  const b = app.store.createConversation({ title: 'Later' });
  app.store.addMessage(b.id, 'user', "What's my dog's name?");
  const rep = app.store.addMessage(b.id, 'assistant', 'Biscuit! The tiny howling menace.');
  const other = app.store.addMessage(b.id, 'user', 'Also the Pine Lake trip is in June.');
  const r = forgetMemory(app, mem, fact.id)!;
  assert.deepEqual(r.hiddenMessages.sort(), [src.id, rep.id].sort());
  assert.equal(app.store.messages(b.id).find((m) => m.id === other.id)!.meta?.forgotten, undefined, 'unrelated messages stay');
  const c = app.store.createConversation();
  assert.doesNotMatch(lastTimeNote(app, c.id, 'Alex') ?? '', /Biscuit/);
  assert.equal(recallMessages(app.store, { query: 'Biscuit' }).length, 0);
});
