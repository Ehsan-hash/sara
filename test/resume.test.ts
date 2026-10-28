// Phase 10: replies cut off by a restart are kept and can be continued; away notifications.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTurn } from '../src/chat.ts';
import { call, makeApp, tempDir, text } from './helpers.ts';

test('a restart mid-reply keeps the text, marks it, and Continue picks up where it stopped', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex' });
  const conv = app.store.createConversation({});
  app.script.push(text('Here is the plan: first, ', 'second, ', 'third.'));
  const ctl = new AbortController();
  const events: string[] = [];
  for await (const ev of runTurn(app, conv.id, 'what is the plan?', ctl.signal)) {
    events.push(ev.type === 'error' ? `error:${ev.message}` : ev.type);
    if (ev.type === 'token' && events.filter((e) => e === 'token').length === 2) ctl.abort(new Error('restart'));
  }
  assert.ok(events.includes('error:Stopped.'));
  const partial = app.store.messages(conv.id).findLast((m) => m.role === 'assistant')!;
  assert.equal(partial.content, 'Here is the plan: first, second, ');
  assert.equal(partial.meta?.partial, true);
  assert.equal(partial.meta?.interrupted, 'restart');

  app.script.push(text('third.'));
  for await (const _ of runTurn(app, conv.id, 'what is the plan?', undefined, { resume: true })) void _;
  const req = app.requests.at(-1)!;
  assert.equal(req.messages.at(-2)?.role, 'assistant');
  assert.match(String(req.messages.at(-1)?.content), /cut off.*Continue from exactly where it stopped/s);
  assert.equal(app.store.messages(conv.id).filter((m) => m.role === 'user').length, 1, 'no new owner message');
  assert.equal(app.store.messages(conv.id).at(-1)?.content, 'third.');
});

test('approval needed sends a notification for the owner', { timeout: 60_000 }, async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-24T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  const { createSaraServer } = await import('../src/server.ts');
  const { OwnerAuth } = await import('../src/auth.ts');
  const { join } = await import('node:path');
  const { ROOT } = await import('./helpers.ts');
  const sent: string[][] = [];
  app.push = { notifyOwner: async (title: string, body: string) => void sent.push([title, body]) } as never;
  createSaraServer({ app, auth: new OwnerAuth(app.dataDir), webDir: join(ROOT, 'web') });
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', });
  const conv = app.store.createConversation({});
  app.script.push([call('c1', 'shell', { command: 'rm -rf /tmp/x' })]);
  const run = app.runTracked!(conv.id, 'list files', (ev) => {
    if (ev.type === 'approval') setTimeout(() => app.approvals.decide(ev.approvalId, false), 10);
  });
  await run;
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'Sara needs your OK');
  assert.match(sent[0][1], /rm -rf \/tmp\/x/);
});
