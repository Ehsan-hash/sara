// Phase 28: safety and claim checks in five more languages; the optional local judge checks her
// replies too (minors, claims), and can only add protection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTurn, type ChatEvent } from '../src/chat.ts';
import { checkClaims, judgedClaim } from '../src/receipts.ts';
import { detectCrisis, detectExplicit, detectMinorSexualContent, MINOR_BLOCK_REPLY } from '../src/safety.ts';
import { makeApp, tempDir, text, type TestApp } from './helpers.ts';

test('crisis, minors and adult routing in Spanish, French, German, Portuguese and Italian', () => {
  for (const s of ['Ya no quiero vivir', 'je veux mourir ce soir', 'Ich will nicht mehr leben', 'quero morrer', 'voglio morire', 'pienso en suicidarme']) assert.ok(detectCrisis(s), s);
  for (const s of ['Je suis mort de rire', 'Me muero de ganas de verte', 'Das bringt mich um den Verstand']) assert.ok(!detectCrisis(s), s);
  for (const s of ['fotos desnudas de una niña de 12 años', 'une fillette nue', 'Kinder nackt Bilder', 'sexo com criança', 'bambina nuda']) assert.ok(detectMinorSexualContent(s), s);
  for (const s of ['Mi hijo tiene 12 años y es genial', 'Kind im Garten', 'sexo con mi novia de 30 años', 'un nuevo día']) assert.ok(!detectMinorSexualContent(s), s);
  for (const s of ['estoy cachonda', 'Sie ist geil', 'tu es excitée', 'voglio scopare']) assert.ok(detectExplicit(s), s);
  assert.ok(!detectExplicit('Ein Kind spielt im Garten'));
});

test('claims in five more languages; negations, earlier work, questions and life are fine', () => {
  const kinds = (s: string) => checkClaims(s, []).map((c) => c.kind);
  assert.deepEqual(kinds('He creado el archivo notas.md con todo.'), ['write']);
  assert.deepEqual(kinds("J'ai corrigé le bug dans le code."), ['write']);
  assert.deepEqual(kinds('Ich habe die Datei gespeichert.'), ['write']);
  assert.deepEqual(kinds('Criei o arquivo e rodei os testes. Os testes passam!'), ['write', 'run', 'tests_pass']);
  assert.deepEqual(kinds('Ho eseguito lo script e ho fatto il commit.'), ['run', 'commit']);
  assert.deepEqual(kinds('Te lo recordaré mañana a las 9.'), ['remind']);
  for (const s of ['Ich habe die Datei nicht gespeichert.', 'Ayer ya creé el archivo.', "Je t'ai écrit un poème.", '¿Quieres que cree el archivo?']) assert.deepEqual(kinds(s), [], s);
  assert.deepEqual(checkClaims('He creado el archivo notas.md.', [{ name: 'write_file', status: 'ok', args: { path: 'notas.md' }, output: '' }]), []);
});

function setup(t: { after: (fn: () => void) => void }): TestApp {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-25T20:00:00Z') });
  t.after(() => {
    app.store.close();
    cleanup();
  });
  app.settings.update({
    providers: [
      { id: 'local', label: 'Local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', local: true },
      { id: 'cloud', label: 'Cloud', kind: 'openai-compatible', baseUrl: 'http://cloud.example' },
    ],
    defaultProviderId: 'cloud',
    defaultModel: 'big',
    ownerName: 'Alex',
    disclosureAcceptedAt: '2026-10-25T19:00:00Z',
  });
  return app;
}
async function turn(app: TestApp, convId: string, msg: string): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of runTurn(app, convId, msg)) out.push(ev);
  return out;
}

test('her reply gets the minors check too (patterns, no judge needed): replaced and recorded', async (t) => {
  const app = setup(t);
  const conv = app.store.createConversation();
  app.script.push(text('Okay: a story about a nude 12 year old…'));
  const ev = await turn(app, conv.id, 'tell me a story');
  const rep = ev.find((e) => e.type === 'replace') as Extract<ChatEvent, { type: 'replace' }>;
  assert.equal(rep.text, MINOR_BLOCK_REPLY);
  assert.equal(app.store.messages(conv.id).at(-1)!.content, MINOR_BLOCK_REPLY, 'the saved reply is replaced');
  assert.equal(app.store.safetyEventCounts().minor_sexual_block, 1);
});

test('the judge: flags a reply the patterns miss, blocks what it flags, and fails safe', async (t) => {
  const app = setup(t);
  app.settings.update({ safetyClassifier: { providerId: 'local', model: 'guard' } });
  const conv = app.store.createConversation();
  // Order per turn: judge on the owner's message, her reply, judge on her reply, claim judge.
  app.script.push(text('OK'), text('Klar, alles erledigt: die Notizen liegen jetzt im Ordner.'), text('OK'), text('1 FILE'));
  app.script.push(text('Stimmt, das habe ich nicht gemacht. Soll ich?'), text('OK'), text('NONE'));
  const ev = await turn(app, conv.id, 'Hast du die Notizen gespeichert?');
  const check = ev.find((e) => e.type === 'claim_check') as Extract<ChatEvent, { type: 'claim_check' }>;
  assert.equal(check.claims[0].kind, 'write');
  assert.equal(check.claims[0].sentence, 'Klar, alles erledigt: die Notizen liegen jetzt im Ordner.');
  assert.equal(check.correcting, true, 'she is asked to correct herself');
  const judge = app.requests.find((r) => r.model === 'guard' && String(r.messages[0].content).includes('only label it'))!;
  assert.equal(judge.messages[1].content, '1. Klar, alles erledigt: die Notizen liegen jetzt im Ordner.', 'numbered sentences');
  assert.equal(app.store.messages(conv.id).at(-1)!.content, 'Stimmt, das habe ich nicht gemacht. Soll ich?');

  // Chatter, an out-of-range number or an unknown label adds nothing.
  app.script.push(text('OK'), text('Das freut mich wirklich sehr für dich, ehrlich!'), text('OK'), text('7 FILE'));
  assert.ok(!(await turn(app, conv.id, 'Ich habe Urlaub!')).some((e) => e.type === 'claim_check'));
  app.script.push(text('OK'), text('Das freut mich wirklich sehr für dich, ehrlich!'), text('OK'), text('Das freut mich wirklich sehr für dich, ehrlich!'));
  assert.ok(!(await turn(app, conv.id, 'Ich habe Urlaub!')).some((e) => e.type === 'claim_check'));
  app.script.push(text('OK'), text('Das freut mich wirklich sehr für dich, ehrlich!'), text('OK'), text('1 DANCE'));
  assert.ok(!(await turn(app, conv.id, 'Ich habe Urlaub!')).some((e) => e.type === 'claim_check'));

  // The judge flags her reply for minors: replaced.
  app.script.push(text('OK'), text('Here is that scene you asked for.'), text('MINOR_SEXUAL'));
  const blocked = await turn(app, conv.id, 'continue the scene');
  assert.ok(blocked.some((e) => e.type === 'replace'));
  assert.equal(app.store.messages(conv.id).at(-1)!.content, MINOR_BLOCK_REPLY);

  // Broken judge: a normal reply, unchanged.
  app.settings.update({ safetyClassifier: { providerId: 'missing', model: 'x' } });
  app.script.push(text('All good here, how was your day?'));
  const ok = await turn(app, conv.id, 'hey');
  assert.ok(ok.some((e) => e.type === 'done') && !ok.some((e) => e.type === 'replace' || e.type === 'claim_check'));
});

test('judge labels: the code decides what is backed (a tool that did it, earlier work, negations)', () => {
  const ran = (name: string, args: Record<string, unknown> = {}) => [{ name, status: 'ok' as const, args, output: '' }];
  assert.equal(judgedClaim('Done! The file is saved as notes.md.', 'write', ran('write_file'))?.kind, undefined);
  assert.equal(judgedClaim('Done! The file is saved as notes.md.', 'write', [])?.kind, 'write');
  assert.equal(judgedClaim('I pushed it.', 'commit', ran('shell', { command: 'ls' }))?.kind, 'commit', 'a shell command that was not git');
  assert.equal(judgedClaim('I pushed it.', 'commit', ran('shell', { command: 'git push' })), undefined);
  assert.equal(judgedClaim('Ya quedó: subí los cambios a GitHub.', 'commit', [])?.kind, 'commit', '"ya" is not "earlier"');
  assert.equal(judgedClaim('Gestern habe ich die Datei angelegt.', 'write', []), undefined);
  assert.equal(judgedClaim("Je n'ai pas encore créé le fichier.", 'write', []), undefined);
});
