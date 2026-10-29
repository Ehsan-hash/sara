// Phase 71: household mode (docs/HOUSEHOLD.md). Unit tests of the household store (invites:
// expiry, single use, only hashes kept), the member's view of settings and keys, the per-member
// policy (models, limits, paused), the member route allowlist, the shared pairing registry, the
// demo refusal, member databases in backups, and the docs. The end-to-end isolation run (the real
// server, two members and the owner, every route family) is test/household-isolation.test.ts.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { createBackup, inspectBackup } from '../src/backup.ts';
import type { AppContext } from '../src/chat.ts';
import { cleanLimits, HouseholdError, HouseholdStore, MEMBER_ROUTES, MEMBER_TOKEN_PREFIX, memberOfToken, memberRouteCheck, MemberPolicy, MemberSettings, memberVault, OWNER_SETTINGS, PairRegistry, type MemberLimits, type MemberRecord } from '../src/household.ts';
import { createSaraServer } from '../src/server.ts';
import { SettingsStore } from '../src/settings.ts';
import { Store } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import { makeApp, ROOT, tempDir } from './helpers.ts';

const closers: (() => void)[] = [];
const dirs: (() => void)[] = [];
after(() => {
  for (const c of closers) c();
  for (const d of dirs) d();
});
function scratch(): string {
  const t = tempDir();
  dirs.push(t.cleanup);
  return t.dir;
}
const MODELS = [
  { providerId: 'p', model: 'm1' },
  { providerId: 'p', model: 'm2' },
];
const LIMITS: MemberLimits = { models: [MODELS[0]], messagesPerDay: 0, costPerDay: 0, voice: true, pictures: true };

test('a server with no members writes no household files', () => {
  const dir = scratch();
  const h = new HouseholdStore(dir);
  assert.deepEqual(h.members(), []);
  assert.deepEqual(h.invites(), []);
  assert.ok(!existsSync(join(dir, 'household.json')));
  assert.ok(!existsSync(join(dir, 'members')));
});

test('invites: owner confirms 18+, only a hash is kept, single use, expiry, revoke, a cap', () => {
  const dir = scratch();
  const clock = { now: new Date('2026-10-29T10:00:00Z') };
  const h = new HouseholdStore(dir, () => clock.now);
  assert.throws(() => h.invite({ name: 'Sam', hours: 24, confirm18: false, limits: LIMITS }), (e: HouseholdError) => e.status === 400 && /18 or older/.test(e.message));
  assert.throws(() => h.invite({ name: 'Sam', hours: 5, confirm18: true, limits: LIMITS }), /how long/);
  assert.throws(() => h.invite({ name: ' ', hours: 24, confirm18: true, limits: LIMITS }), /name/);
  assert.throws(() => h.invite({ name: 'Sam', hours: 24, confirm18: true, limits: { ...LIMITS, models: [] } }), /at least one model/);
  const { code, invite } = h.invite({ name: 'Sam <b>', hours: 24, confirm18: true, limits: LIMITS });
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(invite.name, 'Sam b', 'markup is stripped from the label');
  const file = readFileSync(join(dir, 'household.json'), 'utf8');
  assert.ok(!file.includes(code) && !file.includes(code.replace(/-/g, '')), 'the code itself is never stored');
  // Forgiving typing: lower case and no dashes work.
  assert.deepEqual(h.checkInvite(code.toLowerCase().replace(/-/g, ' ')), { name: 'Sam b', expiresAt: invite.expiresAt });
  // The member must confirm 18+ too.
  assert.throws(() => h.redeem(code, false), /18 or older/);
  const { member, dir: mdir } = h.redeem(code, true);
  assert.equal(member.status, 'active');
  assert.ok(member.memberConfirmed18At && member.ownerConfirmed18At);
  assert.ok(existsSync(mdir) && mdir.startsWith(join(dir, 'members')));
  assert.throws(() => h.redeem(code, true), (e: HouseholdError) => e.status === 404, 'works once');
  // Expiry.
  const late = h.invite({ name: 'Lee', hours: 1, confirm18: true, limits: LIMITS });
  clock.now = new Date(clock.now.getTime() + 61 * 60_000);
  assert.equal(h.checkInvite(late.code), undefined);
  assert.throws(() => h.redeem(late.code, true), /expired/);
  assert.equal(h.invites().length, 0, 'expired invites are swept');
  // Revoke.
  const r = h.invite({ name: 'Kim', hours: 24, confirm18: true, limits: LIMITS });
  assert.equal(h.revokeInvite(r.invite.id), true);
  assert.equal(h.checkInvite(r.code), undefined);
  // The cap counts members and waiting invites.
  for (let i = 0; i < 19; i++) h.invite({ name: `P${i}`, hours: 24, confirm18: true, limits: LIMITS });
  assert.throws(() => h.invite({ name: 'One more', hours: 24, confirm18: true, limits: LIMITS }), /Up to \{n\} people/);
});

test('members: limits, pause, remove (leaving), deletion; ids are checked before any folder is used', () => {
  const dir = scratch();
  const clock = { now: new Date('2026-10-29T10:00:00Z') };
  const h = new HouseholdStore(dir, () => clock.now);
  const { member, dir: mdir } = h.redeem(h.invite({ name: 'Ana', hours: 24, confirm18: true, limits: LIMITS }).code, true);
  writeFileSync(join(mdir, 'x.txt'), 'hers');
  assert.throws(() => cleanLimits({ models: [{ providerId: 'p', model: 'nope' }] }, MODELS), /not set up/);
  assert.throws(() => cleanLimits({ messagesPerDay: 7 }, MODELS), /offered limits/);
  assert.throws(() => cleanLimits({ costPerDay: 3 }, MODELS), /offered limits/);
  const l = cleanLimits({ models: MODELS, messagesPerDay: 50, costPerDay: 0.5, voice: false }, MODELS, LIMITS);
  assert.deepEqual(l, { models: MODELS, messagesPerDay: 50, costPerDay: 0.5, voice: false, pictures: true });
  h.setLimits(member.id, l);
  assert.equal(h.get(member.id)!.limits.messagesPerDay, 50);
  h.setStatus(member.id, 'suspended');
  assert.equal(h.get(member.id)!.status, 'suspended');
  h.setStatus(member.id, 'active');
  h.markLeaving(member.id);
  assert.equal(h.get(member.id)!.status, 'leaving');
  assert.throws(() => h.setStatus(member.id, 'active'), /being removed/);
  assert.deepEqual(h.due(), []);
  clock.now = new Date(clock.now.getTime() + 7 * 86_400_000 + 1000);
  assert.deepEqual(h.due().map((m) => m.id), [member.id]);
  h.deleteMember(member.id);
  assert.ok(!existsSync(mdir));
  assert.equal(h.get(member.id), undefined);
  // Folder names never come from a request unchecked.
  assert.throws(() => h.dirOf('../owner'), /No such member/);
  assert.throws(() => h.dirOf('..'), /No such member/);
});

test("member settings: never the owner's server settings; models only from the allowed list", () => {
  const ownerDir = scratch();
  const mdir = scratch();
  const owner = new SettingsStore(ownerDir);
  owner.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }], defaultProviderId: 'p', defaultModel: 'm2', mcpServers: [{ name: 'x', command: 'x', enabled: true } as never], search: { provider: 'brave' }, toolPermissions: { shell: 'auto' }, ownerName: 'Alex', prices: [] });
  let limits = LIMITS;
  const ms = new MemberSettings(mdir, owner, () => limits);
  const s = ms.get();
  assert.equal(s.providers.length, 1, 'the owner providers are there for the server code');
  assert.equal(s.mcpServers, undefined);
  assert.equal(s.search, undefined);
  assert.deepEqual(s.toolPermissions, {});
  assert.equal(s.ownerName, undefined, "the owner's name isn't the member's");
  assert.equal(s.otherApps?.tools, false);
  assert.deepEqual([s.defaultProviderId, s.defaultModel], ['p', 'm1'], 'the first allowed model, not the owner default');
  // A member's change never writes owner settings.
  ms.update({ providers: [], mcpServers: [], ownerName: 'Ana', companionModel: { providerId: 'p', model: 'm2' }, toolPermissions: { shell: 'auto' } } as never);
  const own = JSON.parse(readFileSync(join(mdir, 'settings.json'), 'utf8')) as Record<string, unknown>;
  // (The settings file always has an empty provider list of its own; the owner's are never copied in.)
  for (const k of OWNER_SETTINGS) assert.deepEqual(own[k], k === 'providers' ? [] : undefined, `${k} written to the member's file`);
  assert.equal(owner.get().providers.length, 1);
  assert.equal(ms.get().ownerName, 'Ana');
  assert.equal(ms.get().companionModel, undefined, 'a model outside the list is dropped');
  limits = { ...LIMITS, models: MODELS };
  assert.deepEqual(ms.get().companionModel, { providerId: 'p', model: 'm2' });
});

test("member vault: read-only, only the keys their models (and switched-on voice/pictures) need", () => {
  const dir = scratch();
  const v = new Vault(dir);
  v.set('provider:p', 'sk-p');
  v.set('provider:q', 'sk-q');
  v.set('voice:openai', 'sk-voice');
  v.set('images:xai', 'sk-img');
  v.set('github:token', 'ghp_secret');
  v.set('bridge:telegram', 'tg');
  let limits: MemberLimits = { ...LIMITS, voice: false, pictures: false };
  const mv = memberVault(v, () => limits);
  assert.equal(mv.get('provider:p'), 'sk-p');
  assert.equal(mv.get('provider:q'), undefined);
  assert.equal(mv.get('voice:openai'), undefined);
  assert.equal(mv.get('images:xai'), undefined);
  assert.equal(mv.get('github:token'), undefined);
  assert.equal(mv.has('bridge:telegram'), false);
  assert.deepEqual(mv.values(), []);
  assert.throws(() => mv.set('provider:p', 'x'), (e: HouseholdError) => e.status === 403);
  assert.throws(() => mv.delete('provider:p'), (e: HouseholdError) => e.status === 403);
  assert.equal(v.get('provider:p'), 'sk-p');
  limits = { ...LIMITS, voice: true, pictures: true };
  assert.equal(mv.get('voice:openai'), 'sk-voice');
  assert.equal(mv.get('images:xai'), 'sk-img');
  assert.equal(mv.get('github:token'), undefined);
});

test('member policy: allowed models, daily message and cost limits, paused accounts', () => {
  const dir = scratch();
  const h = new HouseholdStore(dir);
  const { member, dir: mdir } = h.redeem(h.invite({ name: 'Ana', hours: 24, confirm18: true, limits: { ...LIMITS, messagesPerDay: 20 } }).code, true);
  const store = new Store(join(mdir, 'sara.db'));
  closers.push(() => store.close());
  const app = { store } as unknown as AppContext;
  const policy = new MemberPolicy(h, member.id, () => [app]);
  assert.doesNotThrow(() => policy.checkModel('p', 'm1'));
  assert.throws(() => policy.checkModel('p', 'm2'), /hasn't made m2 available/);
  const conv = store.createConversation({});
  for (let i = 0; i < 20; i++) store.addMessage(conv.id, 'user', `hi ${i}`);
  assert.doesNotThrow(() => policy.checkBudget());
  store.addMessage(conv.id, 'user', 'one more');
  assert.throws(() => policy.checkBudget(), /limit of 20 messages/);
  h.setLimits(member.id, { ...LIMITS, messagesPerDay: 0 });
  assert.doesNotThrow(() => policy.checkBudget());
  h.setStatus(member.id, 'suspended');
  assert.throws(() => policy.checkBudget(), /paused/);
  assert.equal(policy.today().messages, 21);
});

test('member routes: an allowlist; owner-only families, paused and leaving accounts, voice and pictures switches', () => {
  const rec = (over: Partial<MemberRecord> = {}): MemberRecord => ({ id: 'abcdef0123', name: 'A', createdAt: '', status: 'active', ownerConfirmed18At: '', memberConfirmed18At: '', limits: LIMITS, ...over });
  for (const a of ['backups', 'update', 'logs', 'doctor', 'subscriptions', 'mcp', 'bridges', 'github', 'google', 'home', 'workspaces', 'jobs', 'previews', 'team', 'private-local', 'local-models', 'history-import', 'import', 'tools', 'search', 'model-jobs']) {
    const r = memberRouteCheck(rec(), 'GET', [a]);
    assert.equal(r?.status, 403, a);
    assert.equal(r?.ownerOnly, true, a);
  }
  for (const a of ['conversations', 'memories', 'notes', 'library', 'moments', 'scrapbook', 'persona', 'look', 'voice', 'devices', 'settings', 'export', 'adult']) assert.equal(memberRouteCheck(rec(), 'GET', [a]), undefined, a);
  assert.equal(memberRouteCheck(rec(), 'PUT', ['providers', 'p'])?.status, 403, 'providers are read-only for members');
  assert.equal(memberRouteCheck(rec(), 'PUT', ['usage', 'settings'])?.status, 403, 'prices are the owner’s');
  assert.equal(memberRouteCheck(rec(), 'GET', ['household'])?.ownerOnly, true, 'the household admin is the owner’s');
  assert.equal(memberRouteCheck(rec(), 'GET', ['household', 'me']), undefined);
  assert.equal(memberRouteCheck(rec({ status: 'suspended' }), 'GET', ['conversations'])?.status, 403);
  assert.equal(memberRouteCheck(rec({ status: 'suspended' }), 'GET', ['session']), undefined);
  assert.equal(memberRouteCheck(rec({ status: 'leaving' }), 'GET', ['conversations'])?.status, 403);
  assert.equal(memberRouteCheck(rec({ status: 'leaving' }), 'GET', ['export']), undefined);
  assert.equal(memberRouteCheck(rec({ status: 'leaving' }), 'GET', ['household', 'me', 'export']), undefined);
  const noVoice = rec({ limits: { ...LIMITS, voice: false } });
  for (const p of [['live', 'x'], ['calls'], ['video', 'x']]) assert.equal(memberRouteCheck(noVoice, 'GET', p)?.status, 403, p.join('/'));
  assert.equal(memberRouteCheck(noVoice, 'POST', ['voice', 'speak'])?.status, 403);
  assert.equal(memberRouteCheck(noVoice, 'GET', ['voice']), undefined, 'reading voice settings is fine');
  const noPics = rec({ limits: { ...LIMITS, pictures: false } });
  assert.equal(memberRouteCheck(noPics, 'POST', ['look', 'new'])?.status, 403);
  assert.equal(memberRouteCheck(noPics, 'GET', ['photos'])?.status, 403);
  assert.equal(memberRouteCheck(undefined, 'GET', ['conversations'])?.status, 401);
  assert.ok(!MEMBER_ROUTES.has('backups') && MEMBER_ROUTES.has('conversations'));
});

test('member tokens and pairing codes name their space; codes work once, only there', () => {
  assert.equal(memberOfToken(`${MEMBER_TOKEN_PREFIX}abcdef0123.secret`), 'abcdef0123');
  assert.equal(memberOfToken('sara_m.../x'), undefined);
  assert.equal(memberOfToken('plain-owner-token'), undefined);
  const dir = scratch();
  const auth = new OwnerAuth(dir, undefined, { tokenPrefix: `${MEMBER_TOKEN_PREFIX}abcdef0123.` });
  assert.ok(auth.newToken!.startsWith('sara_m.abcdef0123.'));
  assert.ok(auth.verifyToken(auth.newToken!));
  assert.ok(auth.resetToken().startsWith('sara_m.abcdef0123.'), 'a new token keeps the prefix');
  const owner = new OwnerAuth(scratch());
  assert.ok(!owner.newToken!.startsWith('sara_'), "the owner's token is unchanged");
  const pairs = new PairRegistry();
  pairs.issue('abcdef0123', 'AAAA-BBBB-CCCC', 1000);
  assert.equal(pairs.spaceOf('aaaabbbbcccc', 2000), 'abcdef0123');
  assert.equal(pairs.take('owner', 'AAAA-BBBB-CCCC', 2000), false, 'not in another space');
  assert.equal(pairs.take('abcdef0123', 'AAAA-BBBB-CCCC', 2000), true);
  assert.equal(pairs.take('abcdef0123', 'AAAA-BBBB-CCCC', 2000), false, 'once');
  pairs.issue('owner', 'DDDD-EEEE-FFFF', 1000);
  assert.equal(pairs.spaceOf('DDDD-EEEE-FFFF', 1000 + 11 * 60_000), undefined, 'expired');
});

test('demo server: household mode is refused', async () => {
  const dir = scratch();
  const clock = { now: new Date('2026-10-29T12:00:00Z') };
  const app = makeApp(dir, clock);
  closers.push(() => app.store.close());
  const auth = new OwnerAuth(dir, () => clock.now);
  const household = new HouseholdStore(dir);
  const hooks = { store: household, models: () => MODELS.map((m) => ({ ...m, label: 'P' })), join: async () => ({ token: 'x', session: { value: 'x', maxAgeSeconds: 1 } }), usage: () => null, deleteNow: async () => {}, signOutAll: () => {} };
  // Even if main.ts passed the hooks, the demo flag refuses every household route.
  const server = createSaraServer({ app, auth, webDir: join(ROOT, 'web'), demo: true, household: hooks });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const start = await fetch(`${base}/api/demo/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  for (const [method, path] of [['GET', '/api/household'], ['POST', '/api/household/invites'], ['GET', '/api/household/join?code=x'], ['POST', '/api/household/join']] as const) {
    const r = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json', origin: base }, ...(method === 'POST' ? { body: JSON.stringify({ code: 'x', confirm18: true, name: 'x', hours: 24 }) } : {}) });
    assert.equal(r.status, 403, `${method} ${path}`);
  }
  assert.equal(household.invites().length, 0);
  const s = (await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()) as { household?: boolean };
  assert.equal(s.household, undefined);
});

test("backups include every member's databases (snapshotted, not copied live)", () => {
  const dir = scratch();
  const main = new Store(join(dir, 'sara.db'));
  mkdirSync(join(dir, 'members', 'abcdef0123', 'companions', 'c1d2e3f4'), { recursive: true });
  const m = new Store(join(dir, 'members', 'abcdef0123', 'sara.db'));
  const mc = new Store(join(dir, 'members', 'abcdef0123', 'companions', 'c1d2e3f4', 'sara.db'));
  m.createConversation({ title: 'hers' });
  writeFileSync(join(dir, 'members', 'abcdef0123', 'owner.json'), '{}');
  const out = join(dir, 'b.tar.gz');
  createBackup(dir, out, { saraVersion: 'test' });
  for (const s of [main, m, mc]) s.close();
  const names = inspectBackup(out).entries.map((e) => e.path);
  assert.ok(names.includes('members/abcdef0123/sara.db'));
  assert.ok(names.includes('members/abcdef0123/companions/c1d2e3f4/sara.db'));
  assert.ok(names.includes('members/abcdef0123/owner.json'));
  assert.ok(!names.some((n) => /members\/.*sara\.db-(wal|shm)$/.test(n)), 'no live WAL files');
  assert.equal(names.filter((n) => n === 'members/abcdef0123/sara.db').length, 1, 'once, from the snapshot');
});

test('docs: design and threat model are written, and the guide and translations cover the household pages', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'HOUSEHOLD.md'), 'utf8');
  for (const s of ['## Part 1', '## Part 2', 'members/<id>/', 'MEMBER_ROUTES', 'Not in 2.0']) assert.ok(doc.includes(s), s);
  const tm = readFileSync(join(ROOT, 'docs', 'THREAT_MODEL.md'), 'utf8');
  assert.match(tm, /## Household mode \(Phase 71\)/);
  for (const s of ['API key', 'MCP', 'Backups', 'Group chats', 'Events stream', 'invite', 'demo']) assert.ok(tm.toLowerCase().includes(s.toLowerCase()), s);
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  assert.match(html, /data-page="household" data-group="Household" data-title="People on this server" data-owner-only/);
  assert.match(html, /data-page="account" data-group="Household" data-title="Your account" data-member-only/);
  assert.ok(!/style="/.test(readFileSync(join(ROOT, 'web', 'household.js'), 'utf8')), 'no inline styles');
  assert.match(readFileSync(join(ROOT, 'web', 'help.html'), 'utf8'), /<h2 id="household">/);
});
