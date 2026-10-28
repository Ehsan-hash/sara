// Phase 51: the character gallery (every file is a valid, adult, non-romantic character file that
// loads through the normal import) and the work-mode dials (prompt lines only in coding
// conversations and only away from the middle; the guide table is generated from the same data).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { OwnerAuth } from '../src/auth.ts';
import { isRomantic } from '../src/bond.ts';
import { runTurn } from '../src/chat.ts';
import { checkGalleryFile, gallery, GALLERY_DIR } from '../src/gallery.ts';
import { withDialTables } from '../src/guide-dials.ts';
import { buildSystemPrompt, type Persona, validatePersona } from '../src/persona.ts';
import { createSaraServer } from '../src/server.ts';
import { makeUnique } from '../src/studio.ts';
import { LIFE_IDS, ownerFocused, QUIET_FOCUS, traitLines, TRAIT_IDS, TRAITS, WORK_IDS, workLines } from '../src/traits.ts';
import { makeApp, ROOT, tempDir, text } from './helpers.ts';

test('gallery: 6-8 original characters, each a complete, adult, non-romantic character file', () => {
  const list = gallery();
  assert.ok(list.length >= 6 && list.length <= 8, `${list.length} characters`);
  assert.equal(new Set(list.map((g) => g.persona.name)).size, list.length, 'names are unique');
  for (const g of list) {
    const raw = JSON.parse(readFileSync(join(GALLERY_DIR, `${g.id}.json`), 'utf8'));
    const p = raw.persona;
    assert.equal(raw.format, 'sara-character');
    assert.equal(raw.version, 1);
    assert.doesNotThrow(() => checkGalleryFile(g.id, raw));
    assert.ok(Number.isInteger(p.age) && p.age >= 18, `${g.id}: adult`);
    assert.ok(['she', 'he', 'they'].includes(p.pronouns), `${g.id}: pronouns`);
    assert.ok(p.summary.length > 40 && p.background.length >= 2 && p.personality.length >= 3 && p.speech.length >= 2, `${g.id}: complete`);
    assert.ok(p.life?.hobbies && p.life?.job, `${g.id}: interests and work`);
    assert.ok(g.pitch.length <= 140 && g.tags.length === 3, `${g.id}: pitch and three tags`);
    // Dials: known ones only, whole numbers in range, and every one of them is kept on load.
    for (const [k, v] of Object.entries(p.traits)) {
      assert.ok(TRAIT_IDS.includes(k as never), `${g.id}: unknown dial ${k}`);
      assert.ok(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10, `${g.id}: ${k}=${v}`);
    }
    assert.deepEqual(g.persona.traits, p.traits, `${g.id}: dials survive validation`);
    for (const k of Object.keys(p.life)) assert.ok(LIFE_IDS.includes(k), `${g.id}: unknown life field ${k}`);
    // Nothing adult or romantic by default (the gallery isn't for that).
    assert.ok(!isRomantic(p.relationship, p.intimacy), `${g.id}: relationship ${p.relationship}`);
    assert.equal(p.intimacy, undefined, `${g.id}: no intimacy settings`);
    assert.ok((p.traits.romance ?? 5) <= 2 && (p.traits.flirt ?? 5) <= 1, `${g.id}: romance/flirting off`);
    assert.doesNotMatch(JSON.stringify(raw), /\b(sexy|sexual|seduc|lingerie|nsfw|explicit|erotic|flirt(y|s|ing)? with)\b/i, `${g.id}: no adult wording`);
    assert.equal(raw.look, undefined, `${g.id}: no pictures shipped`);
    // Her prompt keeps the safety boundaries and the honesty rule, whatever the character.
    const prompt = buildSystemPrompt(g.persona, { now: new Date(), ownerName: 'Alex' });
    assert.match(prompt, /Never produce sexual content involving minors/);
    assert.match(prompt, /tell them plainly that you are an AI companion/);
  }
  // The loader rejects a minor, as for any character file.
  const bad = JSON.parse(readFileSync(join(GALLERY_DIR, `${gallery()[0].id}.json`), 'utf8'));
  bad.persona.age = 17;
  assert.throws(() => checkGalleryFile('bad', bad), /adult/);
});

function server(t: { after: (fn: () => void | Promise<void>) => void }) {
  const { dir, cleanup } = tempDir();
  const clock = { now: new Date('2026-10-27T15:00:00Z') };
  const app = makeApp(dir, clock);
  app.settings.update({ providers: [{ id: 'p', label: 'P', kind: 'openai-compatible', baseUrl: 'http://x' }], defaultProviderId: 'p', defaultModel: 'm', ownerName: 'Alex' });
  const auth = new OwnerAuth(dir, () => clock.now);
  const token = auth.newToken!;
  const srv = createSaraServer({ app, auth, webDir: join(ROOT, 'web') });
  t.after(async () => {
    await new Promise<void>((r) => srv.close(() => r()));
    app.store.close();
    cleanup();
  });
  const ready = new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)));
  const call = async (path: string, method = 'GET', body?: unknown) =>
    fetch(`${await ready}/api${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { app, call };
}

test('gallery: listed, "Try a line" asks the model as that character, "Use this" goes through the character import', async (t) => {
  const { app, call } = server(t);
  const { characters } = await (await call('/gallery')).json();
  assert.equal(characters.length, gallery().length);
  const hacker = characters.find((c: { id: string }) => c.id === 'chaotic-hacker');
  assert.equal(hacker.name, 'Jax');
  assert.equal(hacker.tags.length, 3);
  app.script.push(text("yo! what are we breaking today?"));
  const tried = await (await call('/gallery/chaotic-hacker/try', 'POST', {})).json();
  assert.equal(tried.line, 'yo! what are we breaking today?');
  assert.match(String(app.requests.at(-1)!.messages[0].content), /^You are Jax, 27\./);
  assert.equal(app.persona.name, 'Sara', 'trying is not using');
  assert.equal((await call('/gallery/nobody/try', 'POST', {})).status, 404);
  // Use this = the existing character import, keeping the look and voice.
  const r = await (await call('/character/import', 'POST', { file: hacker.file, look: false, voice: false })).json();
  assert.equal(r.persona.name, 'Jax');
  assert.equal(r.look, false);
  assert.equal(app.persona.name, 'Jax');
  assert.equal(app.persona.traits?.banter, 9);
  assert.equal(JSON.parse(readFileSync(join(app.dataDir, 'persona.json'), 'utf8')).name, 'Jax');
  // Share this character: the export is a character file that loads again.
  const shared = await (await call('/character/export')).json();
  assert.equal(shared.persona.name, 'Jax');
  assert.equal(shared.persona.traits.bugTease, 8);
});

const P = (extra: Partial<Persona>): Persona => validatePersona({ name: 'Mia', age: 30, summary: 'A friend.', background: ['x'], personality: ['y'], speech: ['z'], boundaries: [], ...extra });

test('work dials: lines only in coding conversations and only away from the middle; chat personality untouched', () => {
  const p = P({ traits: { banter: 9, celebrate: 0, bugTease: 10, warmth: 5 }, quietFocus: true });
  const chat = buildSystemPrompt(p, { now: new Date(), ownerName: 'Alex' });
  assert.doesNotMatch(chat, /While you work together|celebrat|tease often about bugs/i, 'nothing in a plain chat');
  assert.deepEqual(traitLines(p.traits), [], 'work dials are not part of her personality lines');
  const coding = buildSystemPrompt(p, { now: new Date(), ownerName: 'Alex', coding: true });
  assert.match(coding, /## While you work together/);
  assert.match(coding, /you are chatty: running commentary/);
  assert.match(coding, /just report it plainly: no celebrating/);
  assert.match(coding, /You tease often about bugs/);
  assert.ok(!coding.includes(QUIET_FOCUS.line), 'not focused: no quiet line');
  const focused = buildSystemPrompt(p, { now: new Date(), ownerName: 'Alex', coding: true, focused: true });
  assert.match(focused, /keep your replies terse/);
  // A shared work channel counts as work too.
  assert.match(buildSystemPrompt(p, { now: new Date(), ownerName: 'Alex', work: true }), /While you work together/);
  // Middle settings (4-6) add nothing; the switch off adds nothing.
  for (const v of [4, 5, 6]) {
    const mid = P({ traits: { banter: v, celebrate: v, bugTease: v } });
    assert.doesNotMatch(buildSystemPrompt(mid, { now: new Date(), coding: true, focused: true }), /While you work together/, `value ${v}`);
  }
  assert.deepEqual(workLines({ banter: 2, celebrate: 8 }, false, true), [TRAITS.find((d) => d.id === 'banter')!.lines[1], TRAITS.find((d) => d.id === 'celebrate')!.lines[2]]);
  // Every work dial has a line for each non-middle band.
  for (const id of WORK_IDS) {
    for (const v of [0, 1, 2, 3, 7, 8, 9, 10]) assert.equal(workLines({ [id]: v }).length, 1, `${id}=${v}`);
  }
  // "One of a kind" leaves her work style alone.
  const u = makeUnique(P({ traits: { banter: 9, celebrate: 1 } }));
  assert.equal(u.traits?.banter, 9);
  assert.equal(u.traits?.celebrate, 1);
  assert.equal(u.traits?.bugTease, undefined);
});

test('quiet when focused: short commands in a coding conversation make her terse; chat mode and chatting do not', async (t) => {
  const { app } = server(t);
  app.persona = P({ quietFocus: true });
  const conv = app.store.createConversation({ mode: 'coding' });
  const say = async (id: string, msg: string) => {
    app.script.push(text('ok'));
    for await (const _ of runTurn(app, id, msg)) void _;
    return String(app.requests.at(-1)!.messages[0].content);
  };
  assert.doesNotMatch(await say(conv.id, 'run the tests'), /terse/, 'one message is not enough to tell');
  assert.match(await say(conv.id, 'fix the failing one'), /keep your replies terse/);
  assert.doesNotMatch(await say(conv.id, 'Thanks!! That was a long day, how are you doing tonight?'), /terse/, 'chatting again');
  const chat = app.store.createConversation();
  await say(chat.id, 'run the tests');
  assert.doesNotMatch(await say(chat.id, 'fix it'), /terse|While you work/, 'only in coding conversations');
  app.persona = P({});
  await say(conv.id, 'run it');
  assert.doesNotMatch(await say(conv.id, 'again'), /terse/, 'switch off');
  assert.ok(ownerFocused(['run tests', 'fix it', 'commit']));
  assert.ok(!ownerFocused(['hey! how was your weekend?', 'run it']));
});

test('studio: work dials and the switch are offered and saved per companion; Try it at work answers in a coding setting', async (t) => {
  const { app, call } = server(t);
  const defs = await (await call('/persona/studio')).json();
  assert.deepEqual(defs.traits.filter((d: { group: string }) => d.group === 'Work').map((d: { id: string }) => d.id), WORK_IDS);
  assert.equal(defs.quietFocus.label, QUIET_FOCUS.label);
  const draft = { ...app.persona, traits: { ...app.persona.traits, celebrate: 10 }, quietFocus: true };
  const r = await (await call('/persona/studio/try', 'POST', { persona: draft, set: 'work' })).json();
  assert.deepEqual(r.samples.map((s: { id: string }) => s.id), ['tests-pass', 'silly-bug', 'focused']);
  assert.ok(r.samples.every((s: { before?: string; after: string }) => s.before && s.after), 'before and after, side by side');
  const systems = app.requests.slice(-6).map((q) => String(q.messages[0].content));
  const withChanges = systems.filter((s) => /celebrate big/.test(s));
  assert.equal(withChanges.length, 3, 'the new sheet, asked as in a coding conversation');
  assert.equal(withChanges.filter((s) => /keep your replies terse/.test(s)).length, 1, 'the focused sample');
  const saved = await (await call('/persona', 'PUT', draft)).json();
  assert.equal(saved.persona.quietFocus, true);
  assert.equal(saved.persona.traits.celebrate, 10);
});

test('guide: the dial tables in help.html are generated from the dial definitions (incl. the work dials)', () => {
  const help = readFileSync(join(ROOT, 'web', 'help.html'), 'utf8');
  const lf = help.replace(/\r\n/g, '\n');
  assert.equal(withDialTables(lf), lf, 'run: node scripts/gen-guide.ts');
  for (const id of WORK_IDS) assert.match(help, new RegExp(`id="dial-${id}"`));
  assert.match(help, /id="dial-quietFocus"/);
  for (const a of ['history', 'gallery', 'work-dials']) assert.match(help, new RegExp(`id="${a}"`));
});
