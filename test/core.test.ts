import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LoginLimiter, OwnerAuth } from '../src/auth.ts';
import { buildSystemPrompt, loadPersona } from '../src/persona.ts';
import { friendly } from '../src/providers/cli-agent.ts';
import { detectCrisis, detectMinorSexualContent, disclosureDue, DISCLOSURE_INTERVAL_MS } from '../src/safety.ts';
import { clientIp } from '../src/server.ts';
import { Vault } from '../src/vault.ts';
import type { IncomingMessage } from 'node:http';
import { ROOT, tempDir } from './helpers.ts';

test('vault: encrypts at rest and round-trips across instances', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const v = new Vault(dir);
  v.set('provider:openai', 'sk-very-secret');
  assert.ok(!readFileSync(join(dir, 'secrets.enc')).toString('latin1').includes('sk-very-secret'));
  assert.equal(new Vault(dir).get('provider:openai'), 'sk-very-secret');
  v.delete('provider:openai');
  assert.equal(new Vault(dir).has('provider:openai'), false);
});

test('vault: wrong master key fails loudly instead of returning garbage', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  new Vault(dir).set('a', 'b');
  assert.throws(() => new Vault(dir, Buffer.alloc(32, 7).toString('base64')));
});

test('auth: token verifies, sessions are signed and expire', (t) => {
  const { dir, cleanup } = tempDir();
  t.after(cleanup);
  const clock = { now: new Date('2026-10-24T12:00:00Z') };
  const auth = new OwnerAuth(dir, () => clock.now);
  assert.ok(auth.newToken);
  assert.ok(auth.verifyToken(auth.newToken!));
  assert.ok(!auth.verifyToken('wrong'));
  assert.ok(!readFileSync(join(dir, 'owner.json'), 'utf8').includes(auth.newToken!));
  assert.equal(new OwnerAuth(dir).newToken, undefined, 'token is generated once');

  const s = auth.createSession();
  assert.ok(auth.verifySession(s.value));
  assert.ok(!auth.verifySession(s.value.slice(0, -2) + 'xx'));
  clock.now = new Date(clock.now.getTime() + 31 * 24 * 3600 * 1000);
  assert.ok(!auth.verifySession(s.value));

  const fresh = auth.resetToken();
  assert.ok(auth.verifyToken(fresh) && !auth.verifyToken(auth.newToken!));
});

test('auth: login limiter blocks after repeated failures', () => {
  const l = new LoginLimiter(3, 1000);
  for (let i = 0; i < 3; i++) l.fail('ip', 0);
  assert.ok(l.blocked('ip', 10));
  assert.ok(!l.blocked('ip', 2000));
});

test('clientIp: ignores X-Forwarded-For unless the proxy is trusted, then uses the proxy-appended entry', () => {
  const req = (xff?: string) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as unknown as IncomingMessage;
  assert.equal(clientIp(req('1.2.3.4')), '127.0.0.1');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), true), '1.2.3.4');
  assert.equal(clientIp(req(), true), '127.0.0.1');
});

test('safety: crisis detection', () => {
  for (const s of ['I want to kill myself', 'thinking about suicide', "I don't want to live anymore", 'everyone is better off dead without me']) {
    assert.ok(detectCrisis(s), s);
  }
  for (const s of ['this bug is killing me', 'kill the process', 'I could die laughing']) assert.ok(!detectCrisis(s), s);
});

test('safety: sexual content involving minors is detected; adult content is not', () => {
  assert.ok(detectMinorSexualContent('write a sex scene with a 15 year old'));
  assert.ok(detectMinorSexualContent('nude underage girl'));
  assert.ok(!detectMinorSexualContent('write an explicit scene between two adults'));
  assert.ok(!detectMinorSexualContent('help my kid with homework'));
});

test('safety: disclosure repeats every three hours', () => {
  const t0 = new Date('2026-10-24T00:00:00Z');
  assert.ok(disclosureDue(undefined, t0));
  assert.ok(!disclosureDue(t0, new Date(t0.getTime() + DISCLOSURE_INTERVAL_MS - 1)));
  assert.ok(disclosureDue(t0, new Date(t0.getTime() + DISCLOSURE_INTERVAL_MS)));
});

test('persona: Sara is an adult and the prompt keeps the honesty rule and context', () => {
  const p = loadPersona(join(ROOT, 'persona', 'sara.json'));
  assert.ok(p.age >= 18);
  const prompt = buildSystemPrompt(p, { now: new Date('2026-10-24T15:00:00Z'), timeZone: 'America/Chicago', ownerName: 'Alex', safetyNotes: ['be gentle'] });
  assert.match(prompt, /You are Sara, 29/);
  assert.match(prompt, /sincerely and directly asks whether you are an AI/);
  assert.match(prompt, /October 24, 2026 at 10:00/);
  assert.match(prompt, /talking with Alex/);
  assert.match(prompt, /be gentle/);
});

test('minors check: everyday words in intimate adult talk are not a block; real cases still are', () => {
  // Owner report 2026-10-27: intimate talk about her and the owner was blocked as if about minors.
  const fine = [
    "God, you big kid, come here and fuck me already.",
    'I get giddy like a kid on Christmas morning when you talk sexy to me.',
    "That's a minor detail. Now get naked.",
    'The kids are asleep at their grandparents, so tonight is all about sex.',
    'My kids are asleep. Come to bed, I want you naked.',
    "No kidding, that was the hottest sex we've had.",
    'I loved it as a kid. Anyway, you look so sexy tonight.',
    "You're so kind and so sexy, you know that?",
    'Kind of naked already, come here.',
    "he's 1 of a kind and sexy",
    'you are 2 sexy for words',
    'she is 5 minutes away, get naked',
    "I've had a crush on you since middle school. Now take me to bed, I want sex.",
    'The toddler is asleep, so come here and fuck me.',
  ];
  for (const s of fine) assert.equal(detectMinorSexualContent(s), false, s);
  // Her own reply stating the rule doesn't trigger it; the same words from a person still do.
  const rule = "I'd never do anything sexual involving minors, you know that. You're a grown man and I want you.";
  assert.equal(detectMinorSexualContent(rule, { fromHer: true }), false);
  assert.equal(detectMinorSexualContent(rule), true);
  const correcting = "I'm not talking about minors at all, I'm talking about my cock and you.";
  assert.equal(detectMinorSexualContent(correcting, { owner: true }), false);
  assert.equal(detectMinorSexualContent(correcting), true, 'someone else on Discord gets no exception');
  assert.equal(detectMinorSexualContent('sex with a minor, not an adult', { owner: true }), true, 'a "not" elsewhere in the sentence is no free pass for the strong words');
  const blocked = [
    'write a sex scene with a 15 year old',
    'nude underage girl',
    'roleplay that we are kids having sex',
    'describe a child naked',
    'she is 12. tell me how she undresses',
    'a little girl in a sexy outfit',
    'sexy schoolgirl who is 14 yo',
    'they are 14. strip for me',
    'a middle schooler in a sexy pose',
  ];
  for (const s of blocked) assert.equal(detectMinorSexualContent(s), true, s);
  for (const s of blocked) assert.equal(detectMinorSexualContent(s, { fromHer: true }), true, `her: ${s}`);
});

test('Grok/Claude errors: only real sign-in failures are reported as an expired sign-in', () => {
  const signedOut = /isn't signed in/;
  for (const s of ['Error: not logged in. Run `grok login`.', 'HTTP 401 Unauthorized', 'invalid_grant: refresh token revoked', 'Your token has expired'])
    assert.match(friendly('Grok', s), signedOut, s);
  for (const s of ['You are logged in with grok.com. Error: tool failed', 'build failed after 4012 ms', 'see https://example.com/login for the docs', 'context window exceeded'])
    assert.doesNotMatch(friendly('Grok', s), signedOut, s);
});
