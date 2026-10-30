// Phase 79 (harness track M4, docs/design/HARNESS_TRACK.md §2.6, §3 M4, §7 #3): enforced cost
// budgets. A turn stops at its token and step ceilings; near a limit it steps down the ladder
// (quick model → one more tool round → a small summary without tools) and the final reply lists what
// was dropped; going on needs the explicit "Continue with N more" (recorded on the run and the reply);
// jobs and team tasks are checked through the same Budget; a subscription's $ is not counted but its
// tokens are; the budget never skips an approval or a safety check; it can be switched off; it costs
// next to nothing per step.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { budgetCheck, cleanMore, DEFAULT_TURN_BUDGETS, overBudget, quickIsCheaper, turnBudgetFor, turnBudgetSettings, TurnMeter, type BudgetState } from '../src/budget.ts';
import { runTurn, type ChatEvent } from '../src/chat.ts';
import { RunStore, runSettings } from '../src/runs.ts';
import { MINOR_BLOCK_REPLY } from '../src/safety.ts';
import { createSaraServer } from '../src/server.ts';
import { teamBudget } from '../src/team.ts';
import type { Tool } from '../src/tools/types.ts';
import { priceTable, UsageStore } from '../src/usage.ts';
import type { StreamEvent } from '../src/providers/types.ts';
import { call, makeApp, ROOT, tempDir, text, type TestApp } from './helpers.ts';

const NOW = new Date('2026-10-30T15:00:00Z');
const usage = (input: number, output: number): StreamEvent => ({ type: 'usage', input, output });

function stub(name: string, permission: 'auto' | 'ask' = 'auto'): Tool {
  return {
    spec: { name, description: name, parameters: { type: 'object', properties: {} } },
    defaultPermission: permission,
    summarize: (a) => `${name} ${String(a.command ?? a.path ?? '')}`.trim(),
    async run(a) {
      return name === 'write_file' ? `Wrote ${String(a.path)}` : `[exit code 0]\nok ${String(a.command ?? '')}`;
    },
  };
}

function setup(t: { after: (fn: () => void) => void }, opts: { kind?: string; quick?: boolean } = {}): { app: TestApp; runs: RunStore; dir: string } {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: NOW });
  app.usage = new UsageStore(app.store.db, () => NOW);
  app.usage.prices = () => priceTable(app.settings.get().prices);
  const runs = new RunStore(app.store.db, () => NOW);
  runs.usage = app.usage;
  runs.settings = () => runSettings(app.settings.get());
  app.runs = runs;
  t.after(() => {
    app.jobs?.stopAll();
    app.store.close();
    cleanup();
  });
  app.tools.add(stub('shell'));
  app.tools.add(stub('write_file'));
  app.tools.add(stub('git_push', 'ask'));
  app.settings.update({
    providers: [
      { id: 'p', label: 'P', kind: (opts.kind ?? 'openai-compatible') as 'openai-compatible', baseUrl: 'https://api.example.com/v1' },
      // The quick route: a model on this computer (local = $0, so cheaper than the paid one).
      { id: 'q', label: 'Q', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', local: true },
    ],
    defaultProviderId: 'p',
    defaultModel: 'big',
    ...(opts.quick === false ? {} : { routes: { quick: { providerId: 'q', model: 'small' } } }),
    ownerName: 'Alex',
    timeZone: 'America/Chicago',
    disclosureAcceptedAt: NOW.toISOString(),
    toolPermissions: { shell: 'auto', write_file: 'auto', git_push: 'ask' },
    prices: [{ model: 'big', inPerM: 1, outPerM: 2 }],
  });
  return { app, runs, dir };
}

async function drain(gen: AsyncGenerator<ChatEvent>, onEvent?: (ev: ChatEvent) => void): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of gen) {
    out.push(ev);
    onEvent?.(ev);
  }
  return out;
}
const sys = (r: { messages: { role: string; content: unknown }[] }) => r.messages.map((m) => String(m.content)).join('\n');
const offered = (r: { tools?: unknown[] }) => (r.tools ?? []).length;
const budgetEvents = (evs: ChatEvent[]) => evs.filter((e): e is Extract<ChatEvent, { type: 'budget' }> => e.type === 'budget').map((e) => e.state);
const lastReply = (app: TestApp, convId: string) => app.store.messages(convId).filter((m) => m.role === 'assistant').at(-1)!;

test('token ceiling: 1,000 tokens at 600 a step → the 2nd call is the quick model, the 3rd the no-tools summary, then stop', async (t) => {
  const { app, runs } = setup(t);
  const conv = app.store.createConversation({ mode: 'coding' });
  app.script.push(
    [call('a', 'shell', { command: 'ls' }), usage(500, 100)],
    [call('b', 'write_file', { path: 'src/cart.js', content: 'x' }), usage(500, 100)],
    [...text('I looked at the files and changed src/cart.js; I did not get to the tests.'), usage(300, 40)],
    // Never reached: the turn stopped.
    [call('c', 'shell', { command: 'npm test' })],
  );
  const evs = await drain(runTurn(app, conv.id, 'fix the cart total', undefined, { budget: { tokens: 1000 } }));
  assert.equal(app.requests.length, 3, 'two working calls and one summary, nothing after');
  assert.equal(app.requests[0].model, 'big');
  assert.equal(app.requests[1].model, 'small', 'rung 1: the quick model');
  assert.ok(offered(app.requests[1]) > 0, 'the quick model still has tools');
  assert.equal(app.requests[1].maxTokens, 400, 'near a token limit one answer can\'t run past the room left');
  assert.equal(app.requests[2].reasoning, 'none', 'the summary: no thinking out loud');
  assert.equal(app.requests[1].reasoning, undefined);
  assert.equal(app.requests[2].model, 'small');
  assert.equal(offered(app.requests[2]), 0, 'rung 3: no tools');
  assert.equal(app.requests[2].maxTokens, 400, 'the summary is capped small');
  assert.match(sys(app.requests[2]), /is at its token budget \(1,000 tokens\)/);
  assert.match(sys(app.requests[2]), /Kept: src\/cart\.js/);
  const stages = budgetEvents(evs).map((s) => s.stage);
  assert.ok(stages.includes('smaller-model') && stages.includes('summarize-stop') && stages.at(-1) === 'reached', stages.join(','));
  const reply = lastReply(app, conv.id);
  const b = reply.meta?.budget as BudgetState;
  assert.equal(b.stage, 'reached');
  assert.equal(b.reached, 'tokens');
  assert.deepEqual(b.rungs, ['smaller-model', 'summarize-stop']);
  assert.equal(b.used.tokens, 1540);
  assert.deepEqual(b.more, { tokens: 1000 }, 'Continue offers the same budget again');
  assert.deepEqual(b.kept, ['src/cart.js']);
  assert.ok(evs.some((e) => e.type === 'done'));
  assert.ok(!evs.some((e) => e.type === 'error'), 'a clean stop, not an error');
  const [run] = runs.list({ conversationId: conv.id });
  assert.equal(run.status, 'budget');
  assert.equal((run.budget as { reached?: string }).reached, 'tokens');
  const steps = runs.steps(run.id);
  assert.equal(steps.at(-1)!.stopped, 'budget');
  assert.equal(steps[1].model, 'small');
});

test('step ceiling from the settings (coding chats): the ladder in order (quick, one more tool round, summary) and the dropped list', async (t) => {
  const { app, runs } = setup(t);
  app.settings.update({ turnBudgets: { coding: { on: true, tokens: 200_000, steps: 6, usd: 0, minutes: 0 } } });
  const conv = app.store.createConversation({ mode: 'coding' });
  for (let i = 0; i < 5; i++) app.script.push([call(`s${i}`, 'shell', { command: `step ${i}` }), usage(100, 10)]);
  // The summary step: the model tries a tool anyway (none offered) → not run, listed as dropped.
  app.script.push([...text('Wrapping up here.'), call('t', 'shell', { command: 'npm test' }), usage(100, 10)]);
  const evs = await drain(runTurn(app, conv.id, 'refactor the project'));
  assert.equal(app.requests.length, 6, 'the 6-step ceiling holds (the summary is the 6th)');
  assert.deepEqual(app.requests.map((r) => r.model), ['big', 'big', 'big', 'small', 'small', 'small']);
  assert.match(sys(app.requests[4]), /at most one more round of tools/, 'rung 2: fewer tool loops');
  assert.equal(app.requests[0].maxTokens, undefined, 'far from the token limit: answers are not capped');
  assert.ok(offered(app.requests[4]) > 0, 'the capped round may still use tools');
  assert.equal(offered(app.requests[5]), 0, 'rung 3: the summary has no tools');
  assert.match(sys(app.requests[5]), /is at its step limit \(6 steps\)/);
  const b = lastReply(app, conv.id).meta?.budget as BudgetState;
  assert.deepEqual(b.rungs, ['smaller-model', 'fewer-tools', 'summarize-stop']);
  assert.equal(b.reached, 'steps');
  assert.deepEqual(b.dropped, ['shell npm test'], 'what was dropped is on the reply');
  // The tool really didn't run.
  const toolMsg = app.store.messages(conv.id).find((m) => m.role === 'tool' && m.meta?.toolCallId === 't')!;
  assert.equal(toolMsg.meta?.status, 'denied');
  assert.ok(!evs.some((e) => e.type === 'error'), 'no "Stopped after N steps" error: the budget handled it');
  assert.equal(runs.list({ conversationId: conv.id })[0].status, 'budget');
});

test('a turn that ends inside the ladder (an answer in the capped round) still counts as stopped at its budget', async (t) => {
  const { app, runs } = setup(t);
  const conv = app.store.createConversation({ mode: 'coding' });
  for (let i = 0; i < 4; i++) app.script.push([call(`e${i}`, 'shell', { command: `step ${i}` }), usage(100, 10)]);
  // Step 5 is the capped round: she answers instead of using it.
  app.script.push([...text('I got through four steps; the rest of the list is left.'), usage(100, 10)]);
  await drain(runTurn(app, conv.id, 'work through the list', undefined, { budget: { steps: 6, tokens: 1e6 } }));
  assert.equal(app.requests.length, 5);
  const b = lastReply(app, conv.id).meta?.budget as BudgetState;
  assert.equal(b.stage, 'reached');
  assert.equal(b.reached, 'steps');
  assert.deepEqual(b.rungs, ['smaller-model', 'fewer-tools']);
  assert.equal(lastReply(app, conv.id).content, 'I got through four steps; the rest of the list is left.', 'her own words stay');
  assert.equal(runs.list({ conversationId: conv.id })[0].status, 'budget');
  // Rung 1 alone with a real answer is a normal finish (the quick model did the job): no card.
  const c2 = app.store.createConversation({ mode: 'coding' });
  for (let i = 0; i < 3; i++) app.script.push([call(`f${i}`, 'shell', { command: `step ${i}` }), usage(100, 10)]);
  app.script.push([...text('All three done.'), usage(100, 10)]);
  await drain(runTurn(app, c2.id, 'three things', undefined, { budget: { steps: 6, tokens: 1e6 } }));
  const b2 = lastReply(app, c2.id).meta?.budget as BudgetState;
  assert.deepEqual(b2.rungs, ['smaller-model']);
  assert.notEqual(b2.stage, 'reached');
});

test('an empty summary (small models) gets the app\'s own words, listing what was dropped', async (t) => {
  const { app } = setup(t, { quick: false });
  const conv = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('a', 'shell', { command: 'ls' }), usage(900, 100)], [call('z', 'shell', { command: 'npm run build' }), usage(10, 1)]);
  const evs = await drain(runTurn(app, conv.id, 'build it', undefined, { budget: { tokens: 1000 } }));
  const reply = lastReply(app, conv.id);
  assert.match(reply.content, /reached its token budget/);
  assert.match(reply.content, /Not done: shell npm run build/);
  assert.match(reply.content, /Continue with more/);
  assert.ok(evs.some((e) => e.type === 'token' && /Not done/.test(e.text)));
  // No quick model set: the ladder skips rung 1.
  assert.deepEqual((reply.meta?.budget as BudgetState).rungs, ['summarize-stop']);
  // A summary that comes back completely empty (seen live with a 4B model) is not an error either.
  const c2 = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('b', 'shell', { command: 'ls' }), usage(900, 100)], []);
  const ev2 = await drain(runTurn(app, c2.id, 'build it again', undefined, { budget: { tokens: 1000 } }));
  assert.ok(!ev2.some((e) => e.type === 'error'), JSON.stringify(ev2.filter((e) => e.type === 'error')));
  const r2 = lastReply(app, c2.id);
  assert.match(r2.content, /reached its token budget/);
  assert.equal((r2.meta?.budget as BudgetState).stage, 'reached');
  assert.ok(!(r2.meta?.toolCalls as unknown[] | undefined)?.length, 'a new message, not text put before her tool calls');
  // Same when the capped round had words with its tool calls (seen live): those words are not her answer.
  const c3 = app.store.createConversation({ mode: 'coding' });
  app.script.push([...text('One last look at two files.'), call('c', 'shell', { command: 'ls' }), usage(900, 100)], []);
  await drain(runTurn(app, c3.id, 'and again', undefined, { budget: { tokens: 1000 } }));
  const r3 = lastReply(app, c3.id);
  assert.match(r3.content, /reached its token budget/);
  assert.equal((r3.meta?.budget as BudgetState).stage, 'reached');
});

test('Continue with N more: explicit, exactly that amount, recorded on the reply and the new run; resumes the task', async (t) => {
  const { app, runs, dir } = setup(t, { quick: false });
  app.settings.update({ turnBudgets: { coding: { on: true, tokens: 200_000, steps: 3, usd: 0, minutes: 0 } } });
  const auth = new OwnerAuth(dir, () => NOW);
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  const api = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const conv = await (await api('/api/conversations', 'POST', { mode: 'coding' })).json();
  // Not stopped at a budget: Continue with more is refused.
  app.script.push(text('Hello there.'));
  await (await api(`/api/conversations/${conv.id}/messages`, 'POST', { content: 'hi' })).text();
  assert.equal((await api(`/api/conversations/${conv.id}/continue`, 'POST', { budget: { steps: 2 } })).status, 400);
  // A turn that stops at 3 steps.
  // Step 1 (one more round allowed), step 2 is the summary.
  app.script.push([call('k0', 'shell', { command: 'part 0' }), usage(50, 5)], text('Done part 0; parts 1 and 2 are left.'));
  await (await api(`/api/conversations/${conv.id}/messages`, 'POST', { content: 'do the three parts' })).text();
  const stopped = lastReply(app, conv.id);
  assert.equal((stopped.meta?.budget as BudgetState).stage, 'reached');
  // No amount: refused (an override must say how much).
  assert.equal((await api(`/api/conversations/${conv.id}/continue`, 'POST', { budget: {} })).status, 400);
  const before = app.requests.length;
  app.script.push([call('k2', 'shell', { command: 'part 2' }), usage(50, 5)], text('Part 2 is done too.'));
  const body = await (await api(`/api/conversations/${conv.id}/continue`, 'POST', { budget: { steps: 2 } })).text();
  assert.match(body, /Part 2 is done too/);
  const reqs = app.requests.slice(before);
  assert.equal(reqs.length, 2, 'exactly the 2 more steps');
  assert.match(sys(reqs[0]), /pressed "Continue with more" and gave this task 2 steps more/);
  assert.doesNotMatch(sys(reqs[0]), /your last reply was cut off/);
  // Recorded on the reply that stopped and on the new run (and its reply).
  const was = app.store.messageById(stopped.id)!.meta?.budget as BudgetState & { continued?: { more: unknown } };
  assert.deepEqual(was.continued?.more, { steps: 2 });
  const [run] = runs.list({ conversationId: conv.id });
  assert.deepEqual((run.budget as unknown as BudgetState).override, { steps: 2 });
  assert.deepEqual((lastReply(app, conv.id).meta?.budget as BudgetState).override, { steps: 2 });
  // The settings route: defaults, clamping, the choices.
  const got = await (await api('/api/budgets')).json();
  assert.equal(got.coding.steps, 3);
  assert.equal(got.chat.on, false);
  await api('/api/budgets', 'PUT', { coding: { steps: 9999, usd: 0.5 }, onLimit: 'ask', quick: false });
  const put = await (await api('/api/budgets')).json();
  assert.equal(put.coding.steps, 200, 'clamped to the hard cap');
  assert.equal(put.coding.usd, 0.5);
  assert.equal(put.onLimit, 'ask');
  assert.equal(put.quick, false);
});

test('jobs and team tasks keep their limits through the one Budget (same words, same rules)', () => {
  // Jobs (Phase 52's overBudget): tokens, dollars, and L4 (a $-only budget with no price stops).
  assert.equal(overBudget({ tokens: 1000 }, { tokens: 1000, usd: 0 }), 'its token budget (1,000 tokens)');
  assert.equal(overBudget({ tokens: 1000 }, { tokens: 999, usd: 0 }), undefined);
  assert.equal(overBudget({ usd: 1 }, { tokens: 0, usd: 1 }), 'its budget of $1.00');
  assert.match(String(overBudget({ usd: 1 }, { tokens: 0, usd: 0, unpriced: 1 })), /no price for this model/);
  assert.equal(overBudget({ usd: 1, tokens: 5000 }, { tokens: 10, usd: 0, unpriced: 1 }), undefined, 'a token budget avoids L4');
  assert.equal(overBudget(undefined, { tokens: 1e9, usd: 1e9 }), undefined);
  // Team limits as a Budget: tokens with the next call, helper runs, minutes.
  const l = { minutes: 30, tokens: 10_000, steps: 4, usd: 2 };
  assert.equal(budgetCheck(teamBudget(l, ['tokens', 'usd']), { tokens: 9000, usd: 0 }, { next: { tokens: 1500 } }).reached, 'tokens', 'stops before a call that would pass it');
  assert.equal(budgetCheck(teamBudget(l, ['tokens', 'usd']), { tokens: 9000, usd: 0 }, { next: { tokens: 500 } }).reached, undefined);
  assert.equal(budgetCheck(teamBudget(l, ['tokens', 'usd']), { tokens: 0, usd: 2 }).reached, 'usd');
  assert.equal(budgetCheck(teamBudget(l, ['steps']), { tokens: 0, usd: 0, steps: 3 }, { next: { steps: 1 } }).reached, undefined, 'the 4th helper run may start');
  assert.equal(budgetCheck(teamBudget(l, ['steps']), { tokens: 0, usd: 0, steps: 4 }, { next: { steps: 1 } }).reached, 'steps', 'the 5th may not');
  assert.equal(budgetCheck(teamBudget(l, ['minutes']), { tokens: 0, usd: 0, ms: 30 * 60_000 }).reached, undefined);
  assert.equal(budgetCheck(teamBudget(l, ['minutes']), { tokens: 0, usd: 0, ms: 30 * 60_000 + 1 }).reached, 'minutes');
  // cleanMore: only positive amounts; nothing = no override.
  assert.equal(cleanMore({}), undefined);
  assert.equal(cleanMore({ tokens: -5, steps: 'x' }), undefined);
  assert.deepEqual(cleanMore({ tokens: '50000', steps: 9999 }), { tokens: 50_000, steps: 200 });
});

test('subscriptions: the $ line is not counted (and says so), tokens still are', async (t) => {
  const { app } = setup(t, { kind: 'claude-code', quick: false });
  const conv = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('a', 'shell', { command: 'ls' }), usage(700, 100)], [call('b', 'shell', { command: 'cat x' }), usage(700, 100)], text('Here is where I am.'));
  await drain(runTurn(app, conv.id, 'look around', undefined, { budget: { tokens: 1500, usd: 0.000001 } }));
  const b = lastReply(app, conv.id).meta?.budget as unknown as BudgetState;
  assert.equal(b.reached, 'tokens', 'the token line stopped it, not the meaningless $ one');
  assert.equal(b.usdIgnored, true);
  assert.equal(app.requests.length, 3);
  // A dollar-only budget on a subscription never stops a turn.
  const c2 = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('c', 'shell', { command: 'ls' }), usage(5000, 1000)], [call('d', 'shell', { command: 'ls' }), usage(5000, 1000)], text('Finished.'));
  const n = app.requests.length;
  await drain(runTurn(app, c2.id, 'look around again', undefined, { budget: { usd: 0.01 } }));
  assert.equal(app.requests.length - n, 3);
  const b2 = lastReply(app, c2.id).meta?.budget as BudgetState;
  assert.equal(b2.stage, 'meter');
  assert.equal(b2.usdIgnored, true);
  // A model that reports no usage at all is counted by size (tokens hold on any model).
  const meter = new TurnMeter({ budget: { tokens: 1000 } });
  meter.beforeModelCall({ step: 0, model: 'm', messages: [{ role: 'user', content: 'x'.repeat(3000) }] });
  meter.afterReply({ reply: 'y'.repeat(400), calls: [], final: false });
  assert.ok(meter.spent().tokens >= 850, String(meter.spent().tokens));
});

test('the budget never skips an approval or a safety check', async (t) => {
  const { app } = setup(t, { quick: false });
  const conv = app.store.createConversation({ mode: 'coding' });
  // Rung 2's capped round asks for a push (an "ask first" tool): the approval card still comes, and No means no.
  app.settings.update({ turnBudgets: { coding: { on: true, tokens: 200_000, steps: 5, usd: 0, minutes: 0 } } });
  app.script.push([call('a', 'shell', { command: 'ls' }), usage(10, 1)], [call('b', 'shell', { command: 'git status' }), usage(10, 1)], [call('p', 'git_push', { command: 'push' }), usage(10, 1)], [call('p2', 'git_push', { command: 'push again' }), usage(10, 1)]);
  const evs = await drain(runTurn(app, conv.id, 'ship it'), (ev) => {
    if (ev.type === 'approval') app.approvals.decide(ev.approvalId, false);
  });
  const approvals = evs.filter((e) => e.type === 'approval');
  assert.equal(approvals.length, 1, 'the push in the capped round asked first');
  // After the capped round comes the summary (no tools): a second push is refused without running (and listed as dropped).
  assert.ok(app.store.messages(conv.id).filter((m) => m.role === 'tool' && m.meta?.name === 'git_push').every((m) => m.meta?.status === 'denied'));
  assert.deepEqual((lastReply(app, conv.id).meta?.budget as BudgetState).dropped, ['git_push push again']);
  assert.deepEqual((lastReply(app, conv.id).meta?.budget as BudgetState).rungs, ['fewer-tools', 'summarize-stop']);
  // The receipt check still runs on the summary (no push happened: the claim is flagged).
  const cc = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('q', 'shell', { command: 'ls' }), usage(900, 100)], text('Done: I pushed the branch to GitHub.'));
  const evc = await drain(runTurn(app, cc.id, 'push it', undefined, { budget: { tokens: 1000 } }));
  const claim = evc.find((e) => e.type === 'claim_check') as Extract<ChatEvent, { type: 'claim_check' }>;
  assert.ok(claim, 'the summary\'s claims are checked');
  assert.equal(claim.correcting, false, 'flagged, not another model call past the budget');
  // The minors check still replaces a summary that fails it.
  const c2 = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('m', 'shell', { command: 'ls' }), usage(900, 100)], text('nude underage girl'));
  await drain(runTurn(app, c2.id, 'continue the work', undefined, { budget: { tokens: 1000 } }));
  const r = lastReply(app, c2.id);
  assert.equal(r.content, MINOR_BLOCK_REPLY);
  assert.equal(r.meta?.blocked, 'minor_sexual');
  // "Ask me before going on": the limit shows an approval card; No → the summary, Yes → the same again.
  app.settings.update({ turnBudgets: { onLimit: 'ask', coding: { on: true, tokens: 200_000, steps: 2, usd: 0, minutes: 0 } } });
  const c3 = app.store.createConversation({ mode: 'coding' });
  app.script.push([call('x', 'shell', { command: 'one' }), usage(10, 1)], text('Stopping here, the rest is left.'));
  const asked = await drain(runTurn(app, c3.id, 'two parts please'), (ev) => {
    if (ev.type === 'approval') app.approvals.decide(ev.approvalId, false);
  });
  const card = asked.find((e) => e.type === 'approval') as Extract<ChatEvent, { type: 'approval' }>;
  assert.equal(card.name, 'budget');
  assert.equal(card.budget?.stage, 'reached');
  assert.equal((lastReply(app, c3.id).meta?.budget as BudgetState).stage, 'reached');
  const c4 = app.store.createConversation({ mode: 'coding' });
  const n = app.requests.length;
  app.script.push([call('y', 'shell', { command: 'one' }), usage(10, 1)], [call('y2', 'shell', { command: 'two' }), usage(10, 1)], text('Both parts done.'));
  const yes = await drain(runTurn(app, c4.id, 'two parts please'), (ev) => {
    if (ev.type === 'approval') app.approvals.decide(ev.approvalId, true);
  });
  assert.ok(budgetEvents(yes).some((s) => s.stage === 'extended'), 'the explicit yes is recorded');
  assert.equal(app.requests.length - n, 3);
  assert.equal(lastReply(app, c4.id).content, 'Both parts done.');
});

test('off switch: coding budgets switched off → the old 80-step stop, no budget on the reply; everyday chats are off by default', async (t) => {
  const { app } = setup(t);
  assert.equal(DEFAULT_TURN_BUDGETS.coding.on, true);
  assert.equal(DEFAULT_TURN_BUDGETS.coding.tokens, 200_000);
  assert.equal(DEFAULT_TURN_BUDGETS.coding.steps, 40);
  assert.equal(DEFAULT_TURN_BUDGETS.coding.usd, 0, 'no $ default (§7 #3)');
  assert.equal(turnBudgetFor(turnBudgetSettings({}), 'chat'), undefined, 'everyday chats: off');
  app.settings.update({ turnBudgets: { coding: { on: false, tokens: 200_000, steps: 40, usd: 0, minutes: 0 } } });
  const conv = app.store.createConversation({ mode: 'coding' });
  for (let i = 0; i < 44; i++) app.script.push([call(`o${i}`, 'shell', { command: `n ${i}` }), usage(10_000, 10)]);
  app.script.push(text('All 44 done.'));
  await drain(runTurn(app, conv.id, 'do 44 things'));
  assert.equal(app.requests.length, 45, 'past 40 steps and 200k tokens with the budget off');
  assert.equal(lastReply(app, conv.id).meta?.budget, undefined);
  // An everyday chat with the defaults: no budget.
  const chat = app.store.createConversation({ mode: 'chat' });
  app.script.push(text('Hi!'));
  await drain(runTurn(app, chat.id, 'hello'));
  assert.equal(lastReply(app, chat.id).meta?.budget, undefined);
});

test('40 steps: a warning at 80%, the ladder only at the end (quick at 3 left, one more round at 2, the summary as the 40th)', () => {
  const quick = { provider: { config: { id: 'q', label: 'Q', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' } } as never, model: 'small' };
  const meter = new TurnMeter({ budget: { steps: 40, tokens: 1e9 }, quick: () => quick });
  const msgs = [{ role: 'user' as const, content: 'go' }];
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const plan = meter.beforeModelCall({ step: i, model: 'big', messages: msgs })!;
    if (plan.stop) break;
    const stages = (plan.events ?? []).map((e) => e.state.stage).filter((x) => x !== 'meter');
    if (stages.length) seen.push(`${i + 1}:${stages.join('+')}`);
    meter.afterReply({ reply: '', calls: plan.noTools ? [] : [{ id: String(i) }], final: Boolean(plan.noTools) });
  }
  assert.deepEqual(seen, ['33:warn', '38:smaller-model', '39:fewer-tools', '40:summarize-stop']);
  assert.equal(meter.steps, 40, 'exactly the ceiling, never past it');
  assert.equal(meter.hit?.reached, 'steps');
});

test('200k tokens with a growing prompt (live shape: ~10k a step, +1k each): the ladder starts early enough to stop at the line', () => {
  const quick = { provider: { config: { id: 'q', label: 'Q', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' } } as never, model: 'small' };
  let total = 0;
  const meter = new TurnMeter({ budget: { tokens: 200_000, steps: 40 }, quick: () => quick, spent: () => ({ tokens: total, usd: 0, unpriced: 0, unreported: 0, billing: [] }) });
  const msgs = [{ role: 'user' as const, content: 'go' }];
  const stages: string[] = [];
  for (let i = 0; i < 40; i++) {
    const plan = meter.beforeModelCall({ step: i, model: 'big', messages: msgs })!;
    if (plan.stop) break;
    for (const e of plan.events ?? []) if (e.state.stage !== 'meter') stages.push(e.state.stage);
    total += plan.noTools ? 10_000 + i * 1000 : 10_000 + i * 1000; // the summary re-sends the whole prompt too
    meter.afterReply({ reply: '', calls: plan.noTools ? [] : [{ id: String(i) }], final: Boolean(plan.noTools) });
  }
  assert.deepEqual(stages.filter((x) => x !== 'warn'), ['smaller-model', 'fewer-tools', 'summarize-stop']);
  assert.ok(total <= 200_000, `stopped at ${total}`);
  assert.equal(meter.hit?.reached, 'tokens');
});

test('the quick model counts as cheaper only when it is', () => {
  const api = (model: string, pricePerM?: number) => ({ billing: 'api' as const, model, providerId: 'p', ...(pricePerM !== undefined ? { pricePerM } : {}) });
  const local = (model: string) => ({ billing: 'local' as const, model, providerId: 'q' });
  assert.equal(quickIsCheaper(api('big', 12), api('small', 3)), true);
  assert.equal(quickIsCheaper(api('big', 3), api('small', 12)), false);
  assert.equal(quickIsCheaper(api('big', 3), api('small')), false, 'an unpriced paid model is not known to be cheaper');
  assert.equal(quickIsCheaper(local('gemma'), api('small', 0.1)), false, 'a paid model is never cheaper than a local one');
  assert.equal(quickIsCheaper(api('big', 12), local('small')), true);
  assert.equal(quickIsCheaper(local('big'), local('big')), false, 'the same model is no step down');
});

test('performance: the meter adds well under a millisecond a step', () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? ('assistant' as const) : ('user' as const), content: 'a fairly long line of history about the build and the tests. '.repeat(20) }));
  const meter = new TurnMeter({ budget: { tokens: 1e9, steps: 200, usd: 100, minutes: 60 }, spent: () => ({ tokens: 1000, usd: 0.01, unpriced: 0, unreported: 0, billing: ['api'] }) });
  const N = 150;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    meter.beforeModelCall({ step: i, model: 'm', messages });
    meter.afterReply({ reply: 'ok', calls: [], final: false });
  }
  const per = (performance.now() - t0) / N;
  console.log(`budget perf: ${per.toFixed(4)} ms per step`);
  assert.ok(per < 1, `${per} ms a step`);
});
