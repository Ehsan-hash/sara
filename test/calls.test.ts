// Phase 26: Sara calls you (rules, ringing, missed/declined fallbacks, answering into a live call).
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { CallBroker, cleanCallRules, DEFAULT_CALL_RULES, inQuietHours, type Ring } from '../src/calls.ts';
import type { HubEvent } from '../src/events.ts';
import type { Upstream } from '../src/live.ts';
import { ReminderScheduler } from '../src/reminders.ts';
import { createSaraServer } from '../src/server.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 300 && !check(); i++) await wait(10);
  assert.ok(check(), `timed out waiting for ${what}`);
}

test('rules: quiet hours (also across midnight), checked input', () => {
  const r = { ...DEFAULT_CALL_RULES, quietStart: '22:00', quietEnd: '08:00' };
  assert.equal(inQuietHours(r, new Date('2026-10-25T23:30:00Z'), 'UTC'), true);
  assert.equal(inQuietHours(r, new Date('2026-10-25T07:59:00Z'), 'UTC'), true);
  assert.equal(inQuietHours(r, new Date('2026-10-25T08:00:00Z'), 'UTC'), false);
  assert.equal(inQuietHours(r, new Date('2026-10-25T12:00:00Z'), 'UTC'), false);
  assert.equal(inQuietHours({ ...r, quietStart: '13:00', quietEnd: '14:00' }, new Date('2026-10-25T13:30:00Z'), 'UTC'), true);
  assert.equal(inQuietHours({ ...r, quietStart: '', quietEnd: '' }, new Date('2026-10-25T23:30:00Z'), 'UTC'), false);
  // In the owner's time zone: 03:00 UTC is 22:00 in Chicago (CDT).
  assert.equal(inQuietHours(r, new Date('2026-10-25T03:30:00Z'), 'America/Chicago'), true);
  assert.throws(() => cleanCallRules({ quietStart: '25:99' }, DEFAULT_CALL_RULES), /times like 22:00/);
  assert.throws(() => cleanCallRules({ jobs: 'sometimes' }, DEFAULT_CALL_RULES), /Invalid value/);
  const c = cleanCallRules({ enabled: true, maxPerDay: 99, ringSeconds: 1 }, DEFAULT_CALL_RULES);
  assert.equal(c.enabled, true);
  assert.equal(c.maxPerDay, 20);
  assert.equal(c.ringSeconds, 15);
});

test('ringing: what may call, one at a time, daily limit, missed and declined become messages', async (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-25T15:00:00Z') };
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ timeZone: 'UTC' });
  const conv = app.store.createConversation({ title: 'Chat' });
  const events: HubEvent[] = [];
  app.events!.subscribe((e) => events.push(e));
  const rung: Ring[] = [];
  let n = 0;
  const calls = new CallBroker(app, { newId: () => `r${++n}`, ringers: [(r) => void rung.push(r)], canSpeak: () => true });
  app.calls = calls;

  // Off by default: nothing rings (the caller sends a message instead).
  assert.equal(calls.wants('reminder', true), false);
  assert.deepEqual(calls.ring({ kind: 'reminder', reason: 'x', conversationId: conv.id }), { skipped: 'Calls from her are off.' });
  // A test call works even when calls are off (the owner pressed "Call me now").
  const test1 = calls.ring({ kind: 'test', reason: 'test', conversationId: conv.id });
  assert.ok('ring' in test1);
  assert.equal(rung.length, 1, 'every ringer gets it (e.g. the iPhone VoIP push)');
  assert.ok(calls.cancel('r1'));

  app.settings.update({ calls: { enabled: true, ringSeconds: 0.05, maxPerDay: 2 } as never });
  assert.equal(calls.wants('reminder', false), false, "default: only reminders asked as 'call me'");
  assert.equal(calls.wants('reminder', true), true);
  assert.equal(calls.wants('job'), false);
  // Missed: a message with a play button, after the ring time.
  const a = calls.ring({ kind: 'scheduled', reason: 'Reminder: call the dentist', conversationId: conv.id });
  assert.ok('ring' in a);
  assert.deepEqual(calls.ring({ kind: 'scheduled', reason: 'second', conversationId: conv.id }), { skipped: 'She is already ringing.' });
  assert.equal(calls.current?.reason, 'Reminder: call the dentist');
  await until(() => !calls.current, 'missed');
  const missed = app.store.messages(conv.id).at(-1)!;
  assert.equal(missed.role, 'assistant');
  assert.equal(missed.content, 'I tried to call you. Reminder: call the dentist');
  assert.equal((missed.meta as { call: { state: string } }).call.state, 'missed');
  assert.equal((missed.meta as { voiceNote?: boolean }).voiceNote, true);
  assert.ok(events.some((e) => e.type === 'ring' && e.ring.state === 'missed'), 'other devices stop ringing');
  assert.ok(events.some((e) => e.type === 'message' && e.reason === 'reminder'), 'phones get the message');
  // Declined: sent as a message right away.
  const b = calls.ring({ kind: 'scheduled', reason: 'Time to stretch', conversationId: conv.id });
  assert.ok('ring' in b && calls.decline(b.ring.id));
  assert.equal(app.store.messages(conv.id).at(-1)!.content, 'Time to stretch');
  // Daily limit (2 used): the next one is skipped; a test call still works.
  assert.deepEqual(calls.ring({ kind: 'scheduled', reason: 'third', conversationId: conv.id }), { skipped: 'She already called 2 times today.' });
  // Quiet hours (22:00–08:00 UTC) skip reminder calls, not ones the owner set.
  app.settings.update({ calls: { enabled: true, ringSeconds: 0.05, maxPerDay: 9, reminders: 'call' } as never });
  clock.now = new Date('2026-10-25T23:00:00Z');
  assert.deepEqual(calls.ring({ kind: 'reminder', reason: 'late', conversationId: conv.id }), { skipped: 'Quiet hours.' });
  const late = calls.ring({ kind: 'scheduled', reason: 'you asked', conversationId: conv.id });
  assert.ok('ring' in late);
  // Answered: a note in the chat, no fallback message.
  const before = app.store.messages(conv.id).length;
  assert.equal(calls.answer(late.ring.id, 'phone')?.state, 'answered');
  assert.equal(calls.answer(late.ring.id, 'other phone'), undefined, 'only the first device gets the call');
  await wait(100);
  const after = app.store.messages(conv.id);
  assert.equal(after.length, before + 1);
  assert.equal(after.at(-1)!.role, 'notice');
  assert.equal(after.at(-1)!.content, 'call:you asked');
  // Not during a call.
  calls.setInCall(() => true);
  assert.deepEqual(calls.ring({ kind: 'scheduled', reason: 'x', conversationId: conv.id }), { skipped: 'You are on a call.' });
  calls.stop();
  // No Grok voice: no ringing at all (she sends messages instead), and a test call says why.
  const mute = new CallBroker(app, { canCall: () => false });
  assert.equal(mute.wants('scheduled'), false);
  assert.match((mute.ring({ kind: 'test', reason: 't', conversationId: conv.id }) as { skipped: string }).skipped, /need Grok voice/);
});

test('reminders set as "call me" ring instead of posting; without calls they post as before', async (t) => {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-25T15:00:00Z') };
  const app = makeApp(dir, clock);
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({ timeZone: 'UTC' });
  const conv = app.store.createConversation({ title: 'Chat' });
  const remind = app.tools.get('remind')!;
  const ctx = { conversationId: conv.id } as never;
  assert.match(String(await remind.run({ action: 'set', text: 'call mum', when: 'in 1 minute', call: true }, ctx)), /Calls from you are off/);
  app.calls = new CallBroker(app, { ringers: [] });
  const sched = new ReminderScheduler(app, app.planner!);
  clock.now = new Date('2026-10-25T15:02:00Z');
  // Calls off: an ordinary reminder message.
  assert.equal(sched.tick(), 1);
  assert.match(app.store.messages(conv.id).at(-1)!.content, /^Reminder: call mum/);
  // Calls on: the next "call me" reminder rings instead.
  app.settings.update({ calls: { enabled: true, ringSeconds: 30 } as never });
  await remind.run({ action: 'set', text: 'take the pizza out', when: 'in 1 minute', call: true }, ctx);
  assert.match(String(await remind.run({ action: 'list' }, ctx)), /\(call\): take the pizza out/);
  const count = app.store.messages(conv.id).length;
  clock.now = new Date('2026-10-25T15:04:00Z');
  assert.equal(sched.tick(), 1);
  assert.equal(app.store.messages(conv.id).length, count, 'no message while ringing');
  assert.match(app.calls.current!.reason, /take the pizza out/);
  assert.equal(app.calls.current!.kind, 'scheduled');
  app.calls.stop();
});

class FakeVoice implements Upstream {
  onopen: Upstream['onopen'] = null;
  onmessage: Upstream['onmessage'] = null;
  onclose: Upstream['onclose'] = null;
  onerror: Upstream['onerror'] = null;
  sent: Record<string, unknown>[] = [];
  constructor() {
    setTimeout(() => this.onopen?.({}), 5);
  }
  send(d: string | ArrayBufferLike | Uint8Array) {
    if (typeof d !== 'string') return;
    const ev = JSON.parse(d) as Record<string, unknown>;
    this.sent.push(ev);
    if (ev.type === 'session.update') this.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) });
  }
  close() {}
}

test('answering a ring opens a live call where she speaks first; a second device is told it was answered', async (t) => {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-25T15:00:00Z') });
  app.settings.update({ ownerName: 'Pat', timeZone: 'UTC', disclosureAcceptedAt: '2026-10-25T14:00:00Z' });
  app.vault.set('voice:xai', 'xai-test-key');
  const auth = new OwnerAuth(app.dataDir);
  let voice: FakeVoice | undefined;
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web'), liveConnect: () => (voice = new FakeVoice()) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    app.calls?.stop();
    server.close();
    app.store.close();
    cleanup();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const H = { authorization: `Bearer ${auth.newToken}`, 'content-type': 'application/json' };
  // Settings: checked, saved.
  assert.equal((await fetch(`${base}/api/calls`, { method: 'PUT', headers: H, body: JSON.stringify({ quietStart: 'soon' }) })).status, 400);
  const put = await (await fetch(`${base}/api/calls`, { method: 'PUT', headers: H, body: JSON.stringify({ enabled: true, briefing: 'call' }) })).json();
  assert.equal(put.rules.enabled, true);
  assert.equal(put.rules.briefing, 'call');
  // "Call me now".
  const conv = app.store.createConversation({ title: 'Chat' });
  const rung = await (await fetch(`${base}/api/calls/test`, { method: 'POST', headers: H, body: JSON.stringify({ conversationId: conv.id }) })).json();
  assert.equal(rung.ring.state, 'ringing');
  assert.equal((await (await fetch(`${base}/api/calls`, { headers: H })).json()).ring.id, rung.ring.id);
  assert.equal((await fetch(`${base}/api/calls/test`, { method: 'POST', headers: H, body: '{}' })).status, 409, 'one ring at a time');

  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/live/${conv.id}?ring=${rung.ring.id}`, { headers: H } as unknown as string[]);
  const evs: Record<string, unknown>[] = [];
  ws.onmessage = (m) => typeof m.data === 'string' && evs.push(JSON.parse(m.data));
  await until(() => evs.some((e) => e.type === 'ready'), 'ready');
  const opening = voice!.sent.find((e) => e.type === 'session.update' && JSON.stringify(e).includes('You just called Pat'));
  assert.ok(opening, 'she is told she called and why, in her instructions (with her character and safety rules)');
  assert.match(JSON.stringify(opening), /AI/);
  assert.match(JSON.stringify(opening), /This is a test call/);
  assert.equal(voice!.sent.at(-1)!.type, 'response.create', 'and speaks first');
  assert.equal(app.calls!.current, undefined, 'ringing stopped everywhere');
  // A second device answering the same ring is told it's gone.
  const ws2 = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/live/${conv.id}?ring=${rung.ring.id}`, { headers: H } as unknown as string[]);
  const ev2: Record<string, unknown>[] = [];
  ws2.onmessage = (m) => typeof m.data === 'string' && ev2.push(JSON.parse(m.data));
  await until(() => ev2.some((e) => e.type === 'ended'), 'refused');
  assert.match(String(ev2.find((e) => e.type === 'ended')!.reason), /already answered/);
  ws.close();
  // Planner: a reminder added with "call me".
  const rem = await (await fetch(`${base}/api/reminders`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'stretch', when: 'in 2 hours', call: true }) })).json();
  assert.equal(rem.call, true);
  // Declining an old ring: 404.
  assert.equal((await fetch(`${base}/api/calls/${rung.ring.id}/decline`, { method: 'POST', headers: H, body: '{}' })).status, 404);
});
