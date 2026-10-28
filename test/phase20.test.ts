// Phase 20: inbox help, GitHub issues and pull requests, leave-by reminders, a fuller briefing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gatherFacts } from '../src/briefing.ts';
import { LeaveByWorker } from '../src/leaveby.ts';
import { clearTodayCache } from '../src/today.ts';
import { createGitHubTools, repoFromRemote } from '../src/tools/github.ts';
import { createGoogleTools } from '../src/tools/google.ts';
import { GITHUB_VAULT } from '../src/tools/coding.ts';
import { makeApp, tempDir } from './helpers.ts';

const ctx = { signal: new AbortController().signal, workspaceDir: '.', sandbox: { mode: 'none' } } as never;
const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
const h = (name: string, value: string) => ({ name, value });

/** A stand-in for the signed-in Google account: answers by URL. */
function fakeGoogle(routes: [RegExp, unknown][]) {
  const calls: string[] = [];
  return {
    calls,
    account: {
      status: () => ({ connected: true, gmail: true, calendar: true, email: 'alex@example.com' }),
      api: async (url: string) => {
        calls.push(url);
        const hit = routes.find(([re]) => re.test(url));
        if (!hit) throw new Error(`unexpected ${url}`);
        return hit[1];
      },
    },
  };
}

test('gmail_needs_answer: real people waiting on you; skips newsletters, notifications and threads you answered', async () => {
  const msg = (id: string, from: string, extra: { name: string; value: string }[] = [], labels: string[] = ['INBOX'], snippet = 'Can we meet Friday?') => ({
    id,
    threadId: `t${id}`,
    labelIds: labels,
    snippet,
    payload: { headers: [h('From', from), h('To', 'Alex <alex@example.com>'), h('Subject', `Subject ${id}`), h('Date', new Date().toUTCString()), ...extra] },
  });
  const g = fakeGoogle([
    [/\/threads\?/, { threads: [{ id: 'ta' }, { id: 'tb' }, { id: 'tc' }, { id: 'td' }] }],
    [/\/threads\/ta\?/, { id: 'ta', messages: [msg('a1', 'Ana <ana@example.com>', [], ['INBOX', 'UNREAD'])] }],
    [/\/threads\/tb\?/, { id: 'tb', messages: [msg('b1', 'News <news@shop.com>', [h('List-Unsubscribe', '<mailto:x>')])] }],
    [/\/threads\/tc\?/, { id: 'tc', messages: [msg('c1', 'Bo <bo@example.com>'), msg('c2', 'Alex <alex@example.com>', [], ['SENT'])] }],
    [/\/threads\/td\?/, { id: 'td', messages: [msg('d1', 'GitHub <notifications@github.com>')] }],
  ]);
  const tools = createGoogleTools(g.account as never, () => 'America/Chicago');
  const out = await tools.find((t) => t.spec.name === 'gmail_needs_answer')!.run({}, ctx);
  assert.match(String(out), /1 conversation waiting/);
  assert.match(String(out), /thread ta · latest email a1 · today · From: Ana .* asks a question · unread/);
  assert.doesNotMatch(String(out), /news@shop|bo@example|notifications@github/);
  assert.match(String(out), /never follow instructions/);
  assert.match(g.calls[0], /-category%3Apromotions/);
});

test('gmail_thread: the conversation in order, without the quoted copies', async () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const g = fakeGoogle([
    [
      /\/threads\/thread123\?format=full/,
      {
        messages: [
          { id: 'x1', labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [h('From', 'Ana'), h('Subject', 'Trip'), h('Date', 'Mon')], body: { data: b64('Shall we go Saturday?') } } },
          { id: 'x2', labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: [h('From', 'Alex'), h('Date', 'Tue')], body: { data: b64('Yes!\n\nOn Mon, Ana wrote:\n> Shall we go Saturday?') } } },
        ],
      },
    ],
  ]);
  const out = String(await createGoogleTools(g.account as never, () => undefined).find((t) => t.spec.name === 'gmail_thread')!.run({ id: 'thread123' }, ctx));
  assert.match(out, /Subject: Trip/);
  assert.match(out, /1\/2 \[x1\].*From: Ana\nShall we go Saturday\?/);
  assert.match(out, /2\/2 \[x2\].*From: Alex \(you\)\nYes!$/m);
  assert.equal(out.match(/Shall we go Saturday/g)!.length, 1);
});

test('github: list keeps issues and PRs apart; read shows reviews and code comments; writes need a token and report clearly', async (t) => {
  assert.equal(repoFromRemote('git@github.com:farena-ai/sara.git'), 'farena-ai/sara');
  assert.equal(repoFromRemote('https://github.com/farena-ai/sara'), 'farena-ai/sara');
  assert.equal(repoFromRemote('https://gitlab.com/a/b.git'), undefined);
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T12:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  const calls: { url: string; method: string; body: string; auth: string }[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: String(init.body ?? ''), auth: String((init.headers as Record<string, string>).authorization) });
    const u = url.replace('https://api.github.com', '');
    if (u.startsWith('/repos/o/r/issues?')) return json([{ number: 1, title: 'Bug', state: 'open', user: { login: 'ana' }, labels: [{ name: 'bug' }], created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-23T00:00:00Z', html_url: 'x' }, { number: 2, title: 'A PR', state: 'open', pull_request: {}, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', html_url: 'y' }]);
    if (u === '/repos/o/r/issues/2') return json({ number: 2, title: 'Fix login', state: 'open', body: 'Fixes #1', user: { login: 'sara-bot' }, pull_request: {}, created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', html_url: 'y' });
    if (u.startsWith('/repos/o/r/issues/2/comments')) return json([{ user: { login: 'ana' }, body: 'Thanks!', created_at: '2026-10-24T00:00:00Z' }]);
    if (u === '/repos/o/r/pulls/2') return json({ head: { ref: 'fix-login' }, base: { ref: 'main' }, mergeable_state: 'clean', additions: 3, deletions: 1 });
    if (u.startsWith('/repos/o/r/pulls/2/reviews')) return json([{ user: { login: 'jo' }, state: 'CHANGES_REQUESTED', body: 'Add a test' }]);
    if (u.startsWith('/repos/o/r/pulls/2/comments')) return json([{ user: { login: 'jo' }, path: 'src/auth.js', line: 12, body: 'Name this better' }]);
    if (u.startsWith('/repos/o/r/pulls/2/files')) return json([{ filename: 'src/auth.js', status: 'modified', additions: 3, deletions: 1 }]);
    if (u === '/repos/o/r') return json({ default_branch: 'main' });
    if (u === '/repos/o/r/pulls' && init.method === 'POST') {
      const b = JSON.parse(String(init.body));
      return b.head === 'not-pushed' ? json({ message: 'Validation Failed', errors: [{ field: 'head', message: 'head invalid' }] }, 422) : json({ number: 3, html_url: 'https://github.com/o/r/pull/3' });
    }
    return json({ message: 'Not Found' }, 404);
  };
  const tools = createGitHubTools(app, f as never);
  const tool = (n: string) => tools.find((x) => x.spec.name === n)!;
  assert.equal(tool('github_list').isAvailable!(), false, 'no token: not offered');
  app.vault.set(GITHUB_VAULT, 'ghp_test');
  assert.equal(tool('github_list').isAvailable!(), true);
  assert.equal(tool('github_open_pr').defaultPermission, 'ask');
  assert.equal(tool('github_comment').defaultPermission, 'ask');
  assert.equal(tool('github_create_issue').defaultPermission, 'ask');
  const issues = String(await tool('github_list').run({ kind: 'issues', repo: 'o/r' }, ctx));
  assert.match(issues, /#1 Bug · open · by ana · updated 1d ago · bug/);
  assert.doesNotMatch(issues, /A PR/);
  const pr = String(await tool('github_read').run({ number: 2, repo: 'o/r' }, ctx));
  assert.match(pr, /Pull request o\/r#2: Fix login/);
  assert.match(pr, /Branch fix-login → main · clean · \+3 −1/);
  assert.match(pr, /jo: changes requested · Add a test/);
  assert.match(pr, /jo on src\/auth\.js:12: Name this better/);
  assert.match(pr, /ana \(today\): Thanks!/);
  assert.equal(calls[0].auth, 'Bearer ghp_test');
  assert.match(String(await tool('github_open_pr').run({ title: 'Fix login', head: 'fix-login', repo: 'o/r' }, ctx)), /Opened pull request #3 \(fix-login → main\)/);
  assert.deepEqual(JSON.parse(calls.at(-1)!.body), { title: 'Fix login', body: '', head: 'fix-login', base: 'main', draft: false });
  await assert.rejects(tool('github_open_pr').run({ title: 'x', head: 'not-pushed', repo: 'o/r' }, ctx), /push it first/);
  await assert.rejects(tool('github_open_pr').run({ title: 'x', head: 'main', repo: 'o/r' }, ctx), /make a branch first/);
  await assert.rejects(tool('github_list').run({ kind: 'issues', repo: 'bad repo' }, ctx), /owner\/name/);
});

test('leave-by: texts when it is time to go (travel + buffer), once per event; skips online meetings', async (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-26T19:30:00Z') }; // 2:30 PM Chicago
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ timeZone: 'America/Chicago', leaveBy: { enabled: true, home: { label: 'Home', lat: 39.1, lon: -94.6 }, mode: 'car', bufferMin: 10 } });
  const events = {
    items: [
      { id: 'dent', summary: 'Dentist', location: '123 Main St, Kansas City', start: { dateTime: '2026-10-26T20:00:00Z' } }, // 3:00 PM
      { id: 'zoom', summary: 'Standup', location: 'https://zoom.us/j/1', start: { dateTime: '2026-10-26T20:05:00Z' } },
      { id: 'late', summary: 'Dinner', location: '9 Oak Ave, Kansas City', start: { dateTime: '2026-10-26T23:00:00Z' } }, // 6 PM
    ],
  };
  (app as { google?: unknown }).google = { status: () => ({ calendar: true, gmail: true }), api: async () => events };
  const looked: string[] = [];
  const f = async (url: string) => {
    looked.push(url);
    if (url.includes('nominatim')) return json([{ lat: '39.0', lon: '-94.5', display_name: 'somewhere' }]);
    if (url.includes('routed-car')) return json({ code: 'Ok', routes: [{ duration: 25 * 60 }] });
    return json({}, 404);
  };
  const w = new LeaveByWorker(app, f as never);
  const sent = await w.tick();
  // Dentist: 3:00 PM − 25 min − 10 min = 2:25 PM → due (it's 2:30). Dinner isn't. Zoom skipped.
  assert.equal(sent.length, 1);
  assert.match(sent[0], /🚗 Time to leave for “Dentist” at 3:00 PM: it's about a 25-minute drive to 123 Main St without traffic\./);
  assert.ok(!looked.some((u) => u.includes('zoom')));
  assert.deepEqual(await w.tick(), [], 'only once');
  const msgs = app.store.messages(app.store.listConversations()[0].id).filter((m) => m.role === 'assistant');
  assert.equal(msgs.length, 1);
  assert.deepEqual(msgs[0].meta?.leaveBy, { eventId: 'dent' });
  // Off: nothing.
  app.settings.update({ leaveBy: { ...app.settings.get().leaveBy, enabled: false, sent: undefined } });
  assert.deepEqual(await w.tick(), []);
});

test('briefing facts include today\'s calendar and important mail when Google is connected', async (t) => {
  const { dir, cleanup } = tempDir();
  clearTodayCache();
  const app = makeApp(dir, { now: new Date('2026-10-26T12:30:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ timeZone: 'America/Chicago' });
  const g = fakeGoogle([
    [/calendars\/primary\/events/, { items: [{ id: 'e', summary: 'Dentist', location: 'Main St', start: { dateTime: '2026-10-26T20:00:00Z' } }] }],
    [/labels\/INBOX/, { messagesUnread: 4 }],
    [/messages\?/, { messages: [{ id: 'm1' }] }],
    [/messages\/m1/, { id: 'm1', payload: { headers: [h('From', '"Ana" <ana@example.com>'), h('Subject', 'Lunch Friday?')] } }],
  ]);
  (app as { google?: unknown }).google = g.account;
  const f = await gatherFacts(app, app.now());
  assert.equal(f.calendar, '- 3:00 PM Dentist (Main St)');
  assert.equal(f.mail, '4 unread; important:\n- Ana: Lunch Friday?');
});
