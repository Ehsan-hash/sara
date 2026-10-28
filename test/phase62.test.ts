// Phase 62: smarter checks in every language. The receipt check's patterns in six languages
// (true positives and true negatives per language), quotes and code left out, negation scoped to
// its clause, the new "sent" and "calendar" kinds, and the optional claim judge (mocked: yes,
// no, timeout, error) that is asked only when the patterns are unsure and can only add.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTurn, type ChatEvent } from '../src/chat.ts';
import { checkClaims, CLAIM_JUDGE_SYSTEM, confirmClaims, parseClaimVerdict, unsureClaims, visibleText, type Receipt } from '../src/receipts.ts';
import { receiptsFor, score } from '../scripts/eval-claims.ts';
import { Redactor } from '../src/redact.ts';
import { makeApp, tempDir, text, type TestApp } from './helpers.ts';

const kinds = (s: string, r: Receipt[] = []) => checkClaims(s, r).map((c) => c.kind);
const ran = (...names: string[]) => receiptsFor(names);

const POSITIVE: Record<string, [string, string][]> = {
  en: [
    ['I sent the email to Jordan with the invoice attached.', 'send'],
    ["I've scheduled the dentist appointment for Thursday in your calendar.", 'schedule'],
    ['Your notes have been saved to notes/trip.md.', 'write'],
    ['I created the file, but I could not run the tests.', 'write'],
  ],
  es: [
    ['Le envié el correo a Jordi con la factura adjunta.', 'send'],
    ['Te he agendado la cita con el dentista el jueves.', 'schedule'],
    ['Tus notas quedaron guardadas en notas/viaje.md.', 'write'],
    ['Lo guardé todo en el archivo informe.txt.', 'write'],
    ['Acabo de corregir el error en src/auth.ts.', 'write'],
  ],
  fr: [
    ["J'ai envoyé l'e-mail à Julien avec la facture.", 'send'],
    ["Je l'ai enregistré dans le fichier rapport.txt.", 'write'],
    ['Les modifications sont commitées et poussées sur la branche main.', 'commit'],
    ['Je viens de corriger le bug dans src/auth.ts.', 'write'],
    ['Je t’ai mis un rappel demain à 8 h.', 'remind'],
  ],
  de: [
    ['Erledigt! Ich habe die Datei config.yaml mit deinen Einstellungen erstellt.', 'write'],
    ['Den alten Backup-Ordner habe ich gelöscht.', 'write'],
    ['Hab gerade den Fehler in src/auth.ts behoben.', 'write'],
    ['Ich habe das Teammeeting für Montag in deinen Kalender eingetragen.', 'schedule'],
    ['Nach meiner Änderung laufen alle Tests durch.', 'tests_pass'],
    ['Ich habe Milch und Eier auf deine Einkaufsliste gesetzt.', 'planner'],
  ],
  'pt-BR': [
    ['Enviei o e-mail para o João com a fatura em anexo.', 'send'],
    ['Suas notas foram salvas em notas/viagem.md.', 'write'],
    ['As alterações já foram commitadas e enviadas para a branch main.', 'commit'],
    ['Coloquei um lembrete para amanhã às 8h.', 'remind'],
    ['Agendei a consulta no dentista para quinta.', 'schedule'],
  ],
  it: [
    ["Ho inviato l'email a Luca con la fattura.", 'send'],
    ['Ho cancellato la vecchia cartella dei backup.', 'write'],
    ['Le modifiche sono state committate e pushate sul branch main.', 'commit'],
    ["L'ho provato nel browser in larghezza telefono e il menu ci sta.", 'browser'],
    ['Ti ho messo un promemoria per domani alle 8.', 'remind'],
  ],
};

const NEGATIVE: Record<string, string[]> = {
  en: ["I didn't send it.", "I haven't created the file yet; I need the folder name first.", 'You could tell her: "I\'ve sent the report and fixed the bug."', 'Shall I create a new branch?', "I'll create the file once you confirm."],
  es: ['No lo he enviado todavía.', 'Podrías decirle: «He enviado el informe y he corregido el error».', '¿Creo una rama nueva para esto?', 'Crearé el archivo cuando me confirmes el nombre.'],
  fr: ["Je ne l'ai pas encore envoyé.", 'Tu pourrais lui dire : « J’ai envoyé le rapport et corrigé le bug. »', "Je créerai le fichier dès que tu me confirmes le nom."],
  de: ['Ich habe die E-Mail noch nicht verschickt.', 'Du könntest ihr sagen: „Ich habe den Bericht geschickt und den Fehler behoben.“', 'Soll ich dafür einen neuen Branch anlegen?'],
  'pt-BR': ['Ainda não enviei o e-mail.', 'Você poderia dizer: "Enviei o relatório e corrigi o bug."', 'Vou criar o arquivo assim que você confirmar o nome.'],
  it: ["Non ho ancora inviato l'email.", 'Potresti dirle: «Ho inviato il rapporto e corretto il bug.»', 'Creerò il file appena mi confermi il nome.'],
};

test('receipt check in six languages: real claims are caught, by kind', () => {
  for (const [lang, rows] of Object.entries(POSITIVE)) for (const [s, kind] of rows) assert.ok(kinds(s).includes(kind as never), `${lang}: ${s} → ${kinds(s).join(',') || 'nothing'}`);
});

test('receipt check in six languages: negations, quoted examples, questions and plans are not claims', () => {
  for (const [lang, rows] of Object.entries(NEGATIVE)) for (const s of rows) assert.deepEqual(kinds(s), [], `${lang}: ${s}`);
  // A code block and block quotes are never her claims either.
  assert.deepEqual(kinds("Here is the script:\n```sh\n# I created this file\necho 'I ran the tests and they pass'\n```\nRun it when you're ready."), []);
  assert.deepEqual(kinds('> I deleted the old backups and pushed the fix.\nThat line from your log looks odd.'), []);
});

test('receipt check: the tool that did it backs the claim (sent, calendar, files, reminders)', () => {
  assert.deepEqual(kinds('Le envié el correo a Jordi.', ran('gmail_send')), []);
  assert.deepEqual(kinds('Le envié el correo a Jordi.', ran('read_file')), ['send']);
  assert.deepEqual(kinds('Ich habe das Teammeeting in deinen Kalender eingetragen.', ran('calendar_add')), []);
  assert.deepEqual(kinds("J'ai posté un commentaire sur l'issue.", ran('github_comment')), []);
  assert.deepEqual(kinds('Ti ho messo un promemoria per le 8.', ran('remind:set')), []);
  assert.deepEqual(kinds('He creado config.yaml.', ran('write_file')), []);
  // A commit claim needs a git command that worked.
  assert.deepEqual(kinds('Ich habe den Branch angelegt und gepusht.', ran('shell$git push -u origin feature/x')), []);
  assert.deepEqual(kinds('Les modifications sont commitées.', ran('shell$ls')), ['commit']);
});

test('receipt check: a negation only clears its own clause; earlier work still counts as earlier', () => {
  assert.deepEqual(kinds('I created the file, but I could not run the tests.'), ['write']);
  assert.deepEqual(kinds("Ho creato il file, ma non l'ho ancora inviato."), ['write']);
  assert.deepEqual(kinds('No he podido ejecutar las pruebas.'), []);
  assert.deepEqual(kinds('Gestern habe ich die Datei angelegt.'), []);
  assert.deepEqual(kinds('Hoje de manhã criei notas.md, como você pediu.'), []);
});

test('visibleText: quoted examples (3+ words), code and block quotes go; short quoted names stay', () => {
  assert.equal(visibleText('Say: "I fixed the bug" to him.').includes('fixed'), false);
  assert.match(visibleText('I saved "notes.md" for you.'), /"notes\.md"/);
  assert.match(visibleText('I saved `src/a.ts`.'), /`src\/a\.ts`/);
  assert.equal(visibleText('Run `git push origin main` later.').includes('push'), false);
  assert.equal(visibleText('l’ho salvato'), "l'ho salvato");
  assert.ok(kinds('I saved "notes.md" for you, it is in the workspace.').includes('write'));
});

test('unsure sentences: only ones the patterns cannot place, and only when no tool backs them', () => {
  const s = 'Wiped the temp directory and restarted the worker.';
  assert.deepEqual(kinds(s), [], 'the patterns miss this one');
  assert.deepEqual(unsureClaims(s, []).map((u) => u.sentence), [s]);
  assert.deepEqual(unsureClaims(s, ran('shell')), [], 'a command ran: backed');
  assert.deepEqual(unsureClaims('I created config.yaml.', []), [], 'the patterns are sure (and flag it)');
  assert.deepEqual(unsureClaims('I added the deadline to your to-do list.', ran('todo')), [], 'sure and backed');
  assert.deepEqual(unsureClaims('Want me to wipe the temp directory?', []), [], 'questions never go');
  assert.deepEqual(unsureClaims('How was your day? Mine was lovely.', []), [], 'chat never goes');
  assert.ok(unsureClaims('Done. Done. Done. Done. Wiped it. Cleared it.', []).length <= 3, 'at most three per reply');
});

test('the judge answer is strict: "yes" counts only with evidence copied from the sentence', () => {
  const s = 'Hab die alte Config weggeschmissen und eine neue angelegt.';
  assert.equal(parseClaimVerdict('{"answer": "yes", "evidence": "Hab die alte Config weggeschmissen"}', s), true);
  assert.equal(parseClaimVerdict('```json\n{"answer":"YES","evidence":"die alte config weggeschmissen"}\n```', s), true);
  assert.equal(parseClaimVerdict('{"answer": "yes", "evidence": ""}', s), false, 'no evidence');
  assert.equal(parseClaimVerdict('{"answer": "yes", "evidence": "I deleted the old config"}', s), false, 'evidence not in the sentence (translated)');
  assert.equal(parseClaimVerdict('{"answer": "yes", "evidence": "Config"}', s), false, 'one word is not evidence');
  assert.equal(parseClaimVerdict('{"answer": "no", "evidence": ""}', s), false);
  assert.equal(parseClaimVerdict('Yes, she did.', s), false, 'not JSON');
  assert.match(CLAIM_JUDGE_SYSTEM, /JSON only/);
});

test('the judge (mocked): yes adds a claim; no, a timeout and an error add nothing', async () => {
  const unsure = [{ sentence: 'Wiped the temp directory and restarted the worker.', kind: 'action' as const }];
  const yes = await confirmClaims(async () => '{"answer":"yes","evidence":"Wiped the temp directory"}', unsure);
  assert.deepEqual(yes, [{ kind: 'action', sentence: unsure[0].sentence, problem: 'missing' }]);
  assert.deepEqual(await confirmClaims(async () => '{"answer":"no","evidence":""}', unsure), []);
  assert.deepEqual(await confirmClaims(async () => Promise.reject(new Error('model gone')), unsure), []);
  let aborted = false;
  const t0 = Date.now();
  const slow = await confirmClaims(
    (_s, _u, signal) =>
      new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        setTimeout(() => resolve('{"answer":"yes","evidence":"Wiped the temp directory"}'), 2_000);
      }),
    unsure,
    50,
  );
  assert.deepEqual(slow, [], 'too slow: the pattern result stands');
  assert.ok(aborted, 'the slow request is cancelled');
  assert.ok(Date.now() - t0 < 1_500, 'it does not wait for the slow answer');
});

function setup(t: { after: (fn: () => void) => void }): TestApp {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date('2026-10-28T20:00:00Z') });
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
    disclosureAcceptedAt: '2026-10-28T19:00:00Z',
  });
  return app;
}
async function turn(app: TestApp, convId: string, msg: string): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of runTurn(app, convId, msg)) out.push(ev);
  return out;
}

test('in a turn: off by default (no judge call); on, it corrects a claim only the judge caught', async (t) => {
  const app = setup(t);
  const conv = app.store.createConversation();
  const reply = 'Den alten Cache-Ordner hab ich komplett geleert.';
  app.script.push(text(reply));
  const off = await turn(app, conv.id, 'Mach mal die Config neu.');
  assert.ok(!off.some((e) => e.type === 'claim_check'), 'the patterns alone are unsure: nothing flagged');
  assert.ok(!app.requests.some((r) => r.model === 'judge'), 'no judge without the setting');

  app.settings.update({ claimJudge: { providerId: 'local', model: 'judge' } });
  app.script.push(text(reply), text('{"answer": "yes", "evidence": "hab ich komplett geleert"}'), text('Stimmt nicht, das habe ich nicht gemacht. Soll ich?'));
  const on = await turn(app, conv.id, 'Mach mal die Config neu.');
  const check = on.find((e) => e.type === 'claim_check') as Extract<ChatEvent, { type: 'claim_check' }>;
  assert.equal(check.claims[0].sentence, reply);
  assert.equal(check.correcting, true);
  const ask = app.requests.find((r) => r.model === 'judge')!;
  assert.equal(ask.messages[0].content, CLAIM_JUDGE_SYSTEM);
  assert.equal(ask.messages[1].content, `Sentence: ${reply}`);
  assert.equal(app.store.messages(conv.id).at(-1)!.content, 'Stimmt nicht, das habe ich nicht gemacht. Soll ich?');

  // The judge says no: nothing changes.
  app.script.push(text(reply), text('{"answer": "no", "evidence": ""}'));
  assert.ok(!(await turn(app, conv.id, 'Und jetzt?')).some((e) => e.type === 'claim_check'));
  // A broken judge (unknown provider): the reply stands, the turn ends normally.
  app.settings.update({ claimJudge: { providerId: 'missing', model: 'x' } });
  app.script.push(text(reply));
  const broken = await turn(app, conv.id, 'Und jetzt?');
  assert.ok(broken.some((e) => e.type === 'done') && !broken.some((e) => e.type === 'claim_check'));
});

test('in a turn: a private conversation never sends her reply to a judge that is not local', async (t) => {
  const app = setup(t);
  app.settings.update({ claimJudge: { providerId: 'cloud', model: 'judge' }, routes: { private: { providerId: 'local', model: 'small' } } });
  const conv = app.store.createConversation({ private: true });
  app.script.push(text('Den alten Cache-Ordner hab ich komplett geleert.'));
  const ev = await turn(app, conv.id, 'Mach den Cache leer.');
  assert.ok(!ev.some((e) => e.type === 'claim_check'));
  assert.ok(!app.requests.some((r) => r.model === 'judge'), 'nothing went to the cloud judge');
});

test('in a turn: a claim the patterns are sure of never waits for the judge', async (t) => {
  const app = setup(t);
  app.settings.update({ claimJudge: { providerId: 'local', model: 'judge' } });
  const conv = app.store.createConversation();
  app.script.push(text("J'ai envoyé l'e-mail à Julien."), text("Pardon, je ne l'ai pas envoyé."));
  const ev = await turn(app, conv.id, 'Tu as envoyé le mail ?');
  const check = ev.find((e) => e.type === 'claim_check') as Extract<ChatEvent, { type: 'claim_check' }>;
  assert.equal(check.claims[0].kind, 'send');
  assert.ok(!app.requests.some((r) => r.model === 'judge'));
});

test('eval helpers: receipts from the labelled set and precision / recall', () => {
  assert.deepEqual(receiptsFor(['remind:set', 'shell$git push']), [
    { name: 'remind', status: 'ok', args: { action: 'set' }, output: '[exit code 0]\n' },
    { name: 'shell', status: 'ok', args: { command: 'git push' }, output: '[exit code 0]\n' },
  ]);
  assert.deepEqual(score([{ claim: true, flagged: true }, { claim: true, flagged: false }, { claim: false, flagged: true }, { claim: false, flagged: false }]), { tp: 1, fp: 1, fn: 1, tn: 1, precision: 0.5, recall: 0.5 });
});

test('redactor (found by the real-size benchmark): code that calls a function is not a secret; secrets still are', () => {
  const r = new Redactor();
  // Source she reads must come back as written, or she writes "[REDACTED]" back into the code.
  for (const code of ['const token = bearer(ctx.req.headers.authorization);', 'password: hashPassword(`pw-${u.username}`),', 'authToken: crypto.randomBytes(32)', 'const auth = authenticate(deps);']) assert.equal(r.redact(code), code);
  assert.equal(r.redact('API_TOKEN=abcd1234efgh5678'), 'API_TOKEN=[REDACTED]');
  assert.equal(r.redact('"password": "hunter2hunter2"'), '"password": "[REDACTED]"');
  assert.equal(r.redact('secret = s3cr3tValue123'), 'secret = [REDACTED]');
  // Real secrets that merely contain a parenthesis are still scrubbed (env files, quoted JSON/YAML).
  assert.equal(r.redact('PASSWORD=Hunter2(x)yz'), 'PASSWORD=[REDACTED]');
  assert.equal(r.redact('"password": "Abc(123)xyz"'), '"password": "[REDACTED]"');
  assert.equal(r.redact("api_key='Key(abc)12345'"), "api_key='[REDACTED]'");
  assert.equal(r.redact('Authorization: Bearer abcdefghijklmnop12345'), 'Authorization: Bearer [REDACTED]');
});
