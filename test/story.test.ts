// Phase 53: your story together (merged timeline, filters, look backs, the yearly one).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createSaraServer } from '../src/server.ts';
import { emptyLookback, gatherStory, inFilter, keepTrueQuotes, lookbacks, storyFacts, StoryWorker, writeLookback, yearBefore } from '../src/story.ts';
import { makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';

function setup(t: { after: (fn: () => void) => void }, now = '2026-10-27T15:00:00Z') {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date(now) };
  const app: TestApp = makeApp(dir, clock);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex', timeZone: 'UTC', disclosureAcceptedAt: now });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  return { app, clock, dir };
}

/** A year with a bit of everything, plus things that must stay out. */
function seed(app: TestApp, dir: string) {
  const mem = app.memory!;
  const chat = app.store.createConversation({ title: 'Saturday chat' });
  const m1 = app.store.addMessage(chat.id, 'user', 'we finally launched the weather bot!');
  const add = (kind: 'milestone' | 'decision' | 'promise' | 'date', content: string, happenedOn: string, extra: { evidence?: string; onDate?: string; conversationId?: string | null; sourceMessageId?: number | null } = {}) =>
    mem.add({ kind, content, happenedOn, conversationId: extra.conversationId ?? null, sourceMessageId: extra.sourceMessageId ?? null, evidence: extra.evidence ?? null, onDate: extra.onDate ?? null });
  const launch = add('milestone', 'Alex launched the weather bot', '2026-03-14', { evidence: 'we finally launched the weather bot', conversationId: chat.id, sourceMessageId: m1.id });
  add('decision', 'Alex and Sara decided to keep Sundays work-free', '2026-02-01', { evidence: 'no work on Sundays' });
  const kept = add('promise', 'Alex will run a 5k', '2026-04-01', { evidence: "I'll run a 5k this spring" });
  mem.resolve(kept.id, '2026-05-02T10:00:00Z');
  add('promise', 'Sara will check in after the interview', '2026-09-01', { evidence: "I'll check in after your interview" });
  add('promise', 'Alex will call his sister', '2026-06-01', { evidence: "I'll call her by Friday", onDate: '2026-06-05' });
  add('date', "Alex's mom's birthday", '2026-01-10', { onDate: '03-14' });
  const old = add('milestone', 'Alex lives in Austin', '2026-01-05');
  mem.supersede(old.id, launch.id);
  // Other people's chats never show up.
  const partner = app.store.createConversation({ channel: 'telegram', partner: 'Alex' });
  add('milestone', 'Alex got a dog', '2026-05-05', { conversationId: partner.id });
  // Imported history: labelled.
  const imp = app.store.createConversation({ channel: 'import-chatgpt', title: 'Old trip planning' });
  add('milestone', 'Alex moved to Denver', '2025-08-01', { conversationId: imp.id, evidence: 'we just moved to Denver' });
  // Projects: a planner project (later archived), a workspace with a git history, a team task with a PR.
  const pid = app.planner!.projectId('Garden')!;
  app.planner!.updateProject(pid, { description: 'Raised beds', status: 'archived' });
  const ws = join(dir, 'workspaces', 'weather-bot', '.git', 'logs');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'HEAD'), `0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 Sara <sara@example.invalid> ${Date.parse('2026-03-01T12:00:00Z') / 1000} +0000\tcommit (initial): first\n`);
  mkdirSync(join(dir, 'workspaces', 'notes'), { recursive: true }); // no git: not a project
  app.team = {
    list: () => [
      { id: 7, conversationId: chat.id, workspace: 'weather-bot', goal: 'Add a dark mode\nwith tests', status: 'done', createdAt: '2026-07-01T10:00:00Z', endedAt: '2026-07-02T10:00:00Z', workflow: { checkpoints: true, pr: true, prUrl: 'https://github.com/example/weather-bot/pull/3' } },
      { id: 8, conversationId: chat.id, workspace: 'weather-bot', goal: 'Failed thing', status: 'failed', createdAt: '2026-07-05T10:00:00Z', endedAt: null, workflow: null },
    ],
  } as never;
  // Scrapbook: a moment and an inside joke.
  app.scrapbook!.add({ kind: 'moment', text: 'The great pancake incident', addedBy: 'owner' });
  app.scrapbook!.add({ kind: 'joke', text: 'Never trust a waffle.', addedBy: 'sara' });
  return { chat, launch };
}

test('story: one dated timeline from the ledger, projects, workspaces, team, imported history and the scrapbook', (t) => {
  const { app, dir } = setup(t);
  const { chat, launch } = seed(app, dir);
  const all = gatherStory(app);
  const dates = all.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort(), 'oldest first');
  const titles = all.map((i) => i.title);
  assert.ok(!titles.includes('Alex got a dog'), "other people's chats stay out");
  assert.ok(!titles.includes('Alex lives in Austin'), 'notes that are no longer true stay out');
  assert.ok(!titles.includes('Failed thing'), 'only finished team tasks');
  const by = (title: string) => all.find((i) => i.title === title)!;
  assert.equal(by('Alex will run a 5k').status, 'kept');
  assert.equal(by('Sara will check in after the interview').status, 'open');
  assert.equal(by('Sara will check in after the interview').who, 'sara');
  assert.equal(by('Alex will call his sister').status, 'broken', 'due date passed, still open');
  assert.equal(by('Alex will call his sister').who, 'owner');
  assert.equal(by('Alex moved to Denver').imported, 'ChatGPT');
  assert.deepEqual(by('Alex launched the weather bot').open, { type: 'conversation', conversationId: chat.id, messageId: launch.sourceMessageId });
  assert.equal(by('Alex launched the weather bot').detail, 'we finally launched the weather bot');
  const garden = all.filter((i) => i.title === 'Garden').map((i) => i.event);
  assert.deepEqual(garden.sort(), ['finished', 'started']);
  const wsItem = all.find((i) => i.id === 'workspace:weather-bot')!;
  assert.equal(wsItem.date, '2026-03-01', 'first commit date from the git log');
  assert.ok(!all.some((i) => i.id === 'workspace:notes'));
  assert.equal(all.find((i) => i.id === 'team:7')!.title, 'Add a dark mode');
  assert.deepEqual(all.find((i) => i.id === 'pr:7')!.open, { type: 'url', url: 'https://github.com/example/weather-bot/pull/3' });
  assert.equal(all.find((i) => i.title === 'Never trust a waffle.')!.by, 'sara');

  // Filters.
  const count = (f: 'milestones' | 'promises' | 'projects' | 'moments') => gatherStory(app, { filter: f }).length;
  assert.equal(count('promises'), 3);
  assert.equal(count('moments'), 2);
  assert.equal(count('projects'), 5, 'garden started + finished, first commit, team task, pull request');
  assert.equal(count('milestones'), 4, 'two milestones (one imported), a decision and a date');
  assert.ok(gatherStory(app, { filter: 'milestones' }).every((i) => inFilter(i, 'milestones')));
  // Date range.
  const spring = gatherStory(app, { from: '2026-03-01', to: '2026-05-31' });
  assert.ok(spring.every((i) => i.date >= '2026-03-01' && i.date <= '2026-05-31'));
  assert.ok(spring.some((i) => i.title === 'Alex launched the weather bot'));
});

test('look back: facts only, exact-words rule, saved as a reflection, in her talk language', async (t) => {
  const { app, dir } = setup(t);
  seed(app, dir);
  app.settings.update({ talkLanguage: 'es' });
  app.script.push(
    text(
      'What a year, Alex. You launched the weather bot, and you said "we finally launched the weather bot", which made me grin.\n\nYou also told me "I promised to climb Everest with you", which was wild. And you ran that 5k, just like you said.',
    ),
  );
  const lb = await writeLookback(app, { from: '2025-01-01', to: '2026-10-27' });
  const req = app.requests.at(-1)!;
  const note = String(req.messages.at(-1)!.content);
  assert.match(note, /Use ONLY the facts below/);
  assert.match(note, /word for word/);
  assert.match(note, /2026-03-14 milestone: Alex launched the weather bot — exact words: "we finally launched the weather bot"/);
  assert.match(note, /promise \(not kept by its date\): Alex will call his sister/);
  assert.match(note, /imported ChatGPT history, before you knew each other/);
  assert.doesNotMatch(note, /Alex got a dog/);
  assert.match(String(req.messages[0].content), /## Language\nReply in Spanish unless asked otherwise/);
  assert.match(lb.text, /we finally launched the weather bot/, 'a true quote stays');
  assert.doesNotMatch(lb.text, /Everest/, 'a sentence with an invented quote is dropped');
  assert.match(lb.text, /5k/);
  assert.equal(lb.text.split('\n\n').length, 2, 'paragraphs kept');
  const saved = lookbacks(app);
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].from, saved[0].to], ['2025-01-01', '2026-10-27']);
  assert.equal(app.memory!.get(saved[0].id)!.kind, 'reflection');
});

test('look back: an empty range gets kind wording and no model call; a thin one is told to say so', async (t) => {
  const { app, dir } = setup(t);
  const lb = await writeLookback(app, { from: '2020-01-01', to: '2020-12-31' });
  assert.equal(app.requests.length, 0, 'nothing to write from: no model call');
  assert.equal(lb.text, emptyLookback('Alex', '2020-01-01', '2020-12-31'));
  assert.match(lb.text, /don't have much written down/);
  assert.match(lb.text, /Quiet stretches count too/);
  assert.doesNotMatch(lb.text, /fail/i);
  seed(app, dir);
  app.script.push(text('Just one little thing happened in that stretch: your mom\'s birthday made it onto my list.'));
  await writeLookback(app, { from: '2026-01-01', to: '2026-01-31' });
  assert.match(String(app.requests.at(-1)!.messages.at(-1)!.content), /Not much is written down for this time \(1 item\)\. Say so kindly/);
  assert.doesNotMatch(String(app.requests.at(-1)!.messages[0].content), /## Language/, 'English: no language line');
});

test('look back: when the model fails, a plain list of the facts (nothing invented)', async (t) => {
  const { app, dir } = setup(t);
  seed(app, dir);
  app.script.push([{ type: 'error', message: 'boom' } as never]);
  app.providerFactory = () => ({ config: { id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }, listModels: async () => [], stream: async function* () { throw new Error('model down'); } }) as never;
  const lb = await writeLookback(app, { from: '2026-01-01', to: '2026-12-31' });
  assert.match(lb.text, /^Our time from 2026-01-01 to 2026-12-31:/);
  assert.match(lb.text, /Alex will call his sister \(not kept yet\)/);
});

test('keepTrueQuotes: only word-for-word quotes survive (curly quotes and other languages too)', () => {
  const facts = '- 2026-03-14 milestone: launch — exact words: "we finally launched the weather bot"';
  assert.equal(keepTrueQuotes('You said “we finally launched the weather bot!” Yes.', facts).dropped, 0);
  const r = keepTrueQuotes('Tú dijiste «quiero ir a la luna contigo». Fue bonito.', facts);
  assert.equal(r.dropped, 1);
  assert.equal(r.text, 'Fue bonito.');
  assert.equal(yearBefore('2028-02-29'), '2027-02-28');
});

test('yearly look back: off by default; on the anniversary outside quiet hours, once a year, delivered as her message', async (t) => {
  // First message 2025-10-27 → anniversary 2026-10-27.
  const { app, clock, dir } = setup(t, '2025-10-27T15:00:00Z');
  const c = app.store.createConversation({ title: 'Hi' });
  app.store.addMessage(c.id, 'user', 'hey there');
  clock.now = new Date('2026-10-27T03:00:00Z'); // 3 am: quiet hours (22–9)
  seed(app, dir);
  const worker = new StoryWorker(app);
  assert.equal(await worker.tick(), undefined, 'off by default');
  app.settings.update({ story: { yearly: true } });
  assert.equal(await worker.tick(), undefined, 'quiet hours');
  clock.now = new Date('2026-10-27T15:00:00Z');
  app.script.push(text('One year of us, Alex. You launched the weather bot in March.'));
  const sent = await worker.tick();
  assert.match(sent!, /One year of us/);
  assert.match(String(app.requests.at(-1)!.messages.at(-1)!.content), /anniversary of the first time you and Alex talked/);
  const last = app.store.listConversations().flatMap((x) => app.store.messages(x.id)).find((m) => m.meta?.lookback)!;
  assert.equal(last.role, 'assistant');
  assert.match(last.content, /One year of us/);
  assert.equal(app.settings.get().story?.lastYear, 2026);
  assert.equal(await worker.tick(), undefined, 'once a year');
  assert.equal(lookbacks(app).length, 1);
  // Not the day: nothing.
  clock.now = new Date('2027-03-01T15:00:00Z');
  assert.equal(await worker.tick(), undefined);
});

test('story API: owner only, filters, and a look back written in the background', async (t) => {
  const { app, dir } = setup(t);
  seed(app, dir);
  app.story = new StoryWorker(app);
  const auth = new OwnerAuth(app.dataDir);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const j = async (method: string, path: string, body?: unknown, headers: Record<string, string> = H) => {
    const res = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await j('GET', '/story', undefined, {})).status, 401);
  const all = await j('GET', '/story');
  assert.equal(all.status, 200);
  assert.ok(all.body.items.length >= 10);
  assert.equal(all.body.yearly, false);
  assert.equal((await j('GET', '/story?filter=promises')).body.items.length, 3);
  assert.equal((await j('POST', '/story/lookback', { from: '2026-12-01', to: '2026-01-01' })).status, 400);
  app.script.push(text('A good year, Alex.'));
  const started = await j('POST', '/story/lookback', { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(started.status, 202);
  await app.story.pending;
  const after = await j('GET', '/story');
  assert.equal(after.body.running, false);
  assert.equal(after.body.lookbacks[0].text, 'A good year, Alex.');
  assert.equal((await j('DELETE', `/story/lookback/${after.body.lookbacks[0].id}`)).status, 200);
  assert.equal((await j('GET', '/story')).body.lookbacks.length, 0);
  // The yearly switch lives in Settings (You).
  await j('PUT', '/settings', { storyYearly: true });
  assert.equal((await j('GET', '/settings')).body.storyYearly, true);
});

test('story facts: a date that matters carries its own day, not only the day it was noted', (t) => {
  const { app } = setup(t);
  app.memory!.add({ kind: 'date', content: "Ana's birthday", onDate: '1990-11-14', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-27' });
  app.memory!.add({ kind: 'promise', content: 'Sara promised to send the photos', onDate: '2026-11-02', conversationId: null, sourceMessageId: null, happenedOn: '2026-10-20' });
  const items = gatherStory(app, {});
  assert.equal(items.find((i) => i.kind === 'date')?.on, '1990-11-14');
  const facts = storyFacts(items);
  assert.match(facts, /- 2026-10-27 date that matters \(written down that day\): Ana's birthday \(the date itself: 1990-11-14\)/);
  assert.match(facts, /promise \(still open\): Sara promised to send the photos \(due 2026-11-02\)/);
});
