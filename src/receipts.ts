// Receipts are the truth: claims in Sara's reply about actions (writing files, running commands,
// tests, commits, searches) must be backed by a tool receipt from the same turn. Deliberately
// simple and conservative: sentence-level patterns, scoped to work artifacts so ordinary
// conversation ("I wrote you a poem", "I fixed my bike") is not flagged.

export interface Receipt {
  name: string;
  status: 'ok' | 'error' | 'denied';
  args: Record<string, unknown>;
  output: string;
}

/** 'action': found by the optional local judge (any language, any kind of action). */
export type ClaimKind = 'write' | 'run' | 'tests_pass' | 'commit' | 'web' | 'remind' | 'planner' | 'browser' | 'action';

export interface Claim {
  kind: ClaimKind;
  sentence: string;
  /** "missing": no receipt; "contradicted": a receipt shows the opposite (e.g. tests failed). */
  problem: 'missing' | 'contradicted';
}

const ARTIFACT =
  /\b(files?|folders?|director(?:y|ies)|scripts?|code|functions?|class(?:es)?|modules?|tests?|specs?|repo(?:sitory)?|branch(?:es)?|commits?|readme|config|package\.json|bugs?|project|workspace|changes?|patch|feature|endpoint|component|[\w-]+\.(?:js|ts|tsx|jsx|py|md|txt|json|ya?ml|toml|sh|css|html|go|rs|java|rb|php|c|cpp|h|sql))\b/i;
const WRITE_VERB = /\b(?:I(?:'ve| have)?|I just|I've just|I went ahead and)\s+(?:also\s+)?(created|wrote|written|saved|added|updated|edited|modified|changed|fixed|deleted|removed|renamed|implemented|refactored|patched)\b/i;
const RUN_VERB = /\b(?:I(?:'ve| have)?|I just)\s+(?:also\s+)?(ran|run|executed|re-ran|reran|tested|built|installed)\b/i;
const TESTS_PASS = /\b(?:all\s+(?:the\s+)?|the\s+)?tests?\s+(?:are\s+|now\s+)*(?:pass(?:ing|ed|es)?|green|succeed(?:ed|ing)?)\b|\beverything (?:passes|passed|is passing|works now)\b/i;
const COMMIT = /\b(?:I(?:'ve| have)?|I just)\s+(?:also\s+)?(committed|pushed|merged|tagged)\b|\b(?:changes|work|fix(?:es)?)\s+(?:are|is|have been|has been)\s+(?:now\s+)?(committed|pushed)\b/i;
const WEB = /\b(?:I(?:'ve| have)?|I just)\s+(?:also\s+)?(searched|googled|looked (?:it )?up online|checked online|fetched|browsed)\b/i;
const REMIND = /\b(?:I(?:'ll| will|'ve| have)?|I just)\s+(?:also\s+)?(?:set (?:up )?(?:a |the |your |that )?reminders?|remind you|make sure to remind you|ping you)\b|\breminders? (?:is|are|has been|have been|'s) (?:all |now )?set\b|\bI(?:'ve| have)? (?:scheduled|set) (?:it|that|one)\b/i;
const PLANNER = /\b(?:I(?:'ve| have)?|I just)\s+(?:also\s+)?(?:added|put|saved|wrote|written|jotted|noted|marked|checked off|crossed off|ticked off)\b[^.!?]*\b(to-?do|to do list|task|tasks|list|planner|notes?|done|complete)\b/i;
/**
 * Phase 49: "I tested it in the browser", "I checked it on my phone width", "I took a screenshot",
 * "I clicked through it": only true when her testing-browser tools ran in this turn.
 */
const BROWSER = /\b(?:I(?:'ve| have)?|I just)\s+(?:also\s+)?(?:(?:tested|checked|tried|opened|viewed|looked at|clicked (?:through|around)|went through|previewed)\b[^.!?]{0,80}\b(?:in (?:the |a |my )?(?:testing )?browser|in the preview|(?:at|on) (?:a |the )?(?:phone|mobile|desktop)(?: width| size| screen)?|phone width|mobile width|on (?:a )?(?:small|narrow) screens?)|(?:took|taken|grabbed) (?:a |some )?screenshots?|clicked (?:through|around)(?: (?:it|the app|the page))?)\b/i;
const SCREENSHOT = /\b(?:I(?:'ve| have)?|I just)\s+(?:also\s+)?(?:took|taken|grabbed) (?:a |some |two |both )?screenshots?\b|\b(?:the |my )?screenshots? (?:show|shows|showed|confirm|confirms)\b/i;
const BROWSER_TOOLS = new Set(['browser_open', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_read', 'browser_check']);

/** Past-turn references are allowed: those receipts live in earlier turns. */
const EARLIER = /\b(earlier|before|previously|last time|yesterday|already|this morning|the other day|in our last)\b/i;
const NEGATED = /\b(didn't|did not|haven't|have not|couldn't|could not|wasn't able|won't|can't|cannot|not yet|failed to|unable to)\b/i;

// Phase 28: the same claims in Spanish, French, German, Portuguese and Italian. Unicode-aware word
// edges (see safety.ts `words`); German puts the verb last ("ich habe die Datei erstellt").
const w = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'iu');
const I18N = {
  artifact: w(
    'archivos?|ficheros?|carpetas?|código|scripts?|pruebas?|tests?|repositorio|rama|commits?|proyecto|cambios|fichiers?|dossiers?|code|répertoire|dépôt|branche|projet|modifications?|datei(?:en)?|ordner|skript|tests?|repo|zweig|projekt|änderungen|arquivos?|pastas?|testes?|repositório|projeto|alterações|mudanças|file|cartelle?|codice|progetto|modifiche|[\\w-]+\\.(?:js|ts|py|md|txt|json|ya?ml|sh|css|html)',
  ),
  write: w(
    'he (?:creado|escrito|guardado|añadido|actualizado|editado|modificado|cambiado|corregido|arreglado|borrado|eliminado|renombrado|implementado)|creé|escribí|guardé|actualicé|corregí|arreglé|borré|eliminé|' +
      "j'ai (?:créé|écrit|enregistré|ajouté|mis à jour|modifié|changé|corrigé|supprimé|renommé|implémenté)|" +
      'ich habe[^.!?]{0,60}(?:erstellt|geschrieben|gespeichert|hinzugefügt|aktualisiert|bearbeitet|geändert|behoben|repariert|gelöscht|entfernt|umbenannt|implementiert)|' +
      'criei|escrevi|salvei|adicionei|atualizei|editei|modifiquei|alterei|corrigi|consertei|apaguei|deletei|removi|renomeei|implementei|' +
      'ho (?:creato|scritto|salvato|aggiunto|aggiornato|modificato|cambiato|corretto|sistemato|cancellato|eliminato|rinominato|implementato)',
  ),
  run: w(
    'he (?:ejecutado|corrido|probado|compilado|instalado)|ejecuté|corrí|compilé|instalé|' +
      "j'ai (?:lancé|exécuté|testé|compilé|installé)|" +
      'ich habe[^.!?]{0,60}(?:ausgeführt|gestartet|getestet|gebaut|kompiliert|installiert)|' +
      'executei|rodei|testei|compilei|instalei|' +
      'ho (?:eseguito|lanciato|testato|compilato|installato)',
  ),
  tests: w(
    '(?:todas )?las pruebas (?:ya )?pasan|los tests pasan|todo pasa|' +
      'les tests passent|tous les tests passent|tout passe|' +
      'alle tests (?:sind grün|bestehen|laufen durch)|die tests (?:sind grün|bestehen|laufen durch)|' +
      'os testes passam|todos os testes passam|' +
      'i test passano|tutti i test passano',
  ),
  commit: w(
    'he hecho (?:el )?(?:commit|push)|hice (?:el )?(?:commit|push)|he subido los cambios|' +
      "j'ai (?:commité|poussé|fusionné|fait (?:le |un )?commit)|" +
      'ich habe[^.!?]{0,60}(?:committet|commited|gepusht|gemergt|hochgeladen)|' +
      'fiz (?:o )?(?:commit|push)|' +
      'ho fatto (?:il )?(?:commit|push)|ho pushato',
  ),
  web: w(
    'he buscado|busqué (?:en internet|en la web|online)|' +
      "j'ai (?:cherché|recherché) (?:sur internet|en ligne|sur le web)|" +
      'ich habe[^.!?]{0,60}(?:gegoogelt|im internet gesucht|online nachgesehen)|' +
      'pesquisei|procurei na internet|' +
      'ho cercato (?:su internet|online|sul web)',
  ),
  remind: w(
    'te lo recordaré|te recordaré|he puesto un recordatorio|recordatorio (?:está )?(?:listo|puesto)|' +
      "je te le rappellerai|je te rappellerai|j'ai (?:mis|programmé|créé) un rappel|rappel (?:est )?(?:programmé|créé)|" +
      'ich erinnere dich|ich habe[^.!?]{0,40}erinnerung[^.!?]{0,20}(?:gesetzt|eingerichtet|erstellt)|erinnerung (?:ist )?gesetzt|' +
      'vou te lembrar|eu te lembro|criei um lembrete|lembrete (?:está )?(?:criado|definido|marcado)|' +
      'te lo ricorderò|ti ricorderò|ho (?:impostato|creato|messo) un promemoria|promemoria (?:è )?impostato',
  ),
  planner: w(
    '(?:he añadido|añadí|he apuntado|apunté|he marcado|marqué)[^.!?]{0,60}(?:lista|tareas?|notas?|hecho)|' +
      "(?:j'ai ajouté|j'ai noté|j'ai coché)[^.!?]{0,60}(?:liste|tâches?|notes?|fait)|" +
      'ich habe[^.!?]{0,60}(?:liste|aufgabe|notiz)[^.!?]{0,30}(?:hinzugefügt|eingetragen|abgehakt|notiert)|' +
      '(?:adicionei|anotei|marquei)[^.!?]{0,60}(?:lista|tarefas?|notas?|feito)|' +
      '(?:ho aggiunto|ho segnato|ho annotato)[^.!?]{0,60}(?:lista|attività|compiti|note|fatto)',
  ),
  // Not "ya", "já" or "schon": too common as fillers ("ya quedó" = "done").
  earlier: w('antes|ayer|esta mañana|la otra vez|avant|hier|déjà|ce matin|la dernière fois|vorhin|gestern|bereits|heute morgen|letztes mal|ontem|hoje de manhã|da última vez|prima|ieri|già|stamattina|l\'ultima volta'),
  negated: w("no he|no pude|no lo|todavía no|aún no|je n'ai pas|je n'ai rien|pas encore|je ne peux pas|nicht|kein(?:e|en)?|noch nicht|não|ainda não|non ho|non sono riuscit[oa]|non ancora|non posso"),
};

const WRITE_TOOLS = new Set(['write_file', 'edit_file']);

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function exitCode(output: string): number | null {
  const m = output.match(/^\[exit code (\d+)/);
  return m ? Number(m[1]) : null;
}

/** File-ish names in a sentence ("eval-note.txt", "src/app.ts"). */
const NAMES = /[\w./-]+\.[A-Za-z]{1,5}\b/g;

/**
 * True if an earlier receipt in this conversation names the same file/artifact the sentence
 * names. Lets Sara truthfully recap earlier work ("tonight I created eval-note.txt") without
 * letting a vague claim ride on unrelated old receipts.
 */
function priorSupports(sentence: string, prior: Receipt[], kinds: (r: Receipt) => boolean): boolean {
  const names = [...new Set(sentence.match(NAMES) ?? [])].map((n) => n.toLowerCase()).filter((n) => !/^(e\.g|i\.e|etc)\b/.test(n));
  if (!names.length) return false;
  return prior.some((r) => r.status === 'ok' && kinds(r) && names.some((n) => JSON.stringify(r.args).toLowerCase().includes(n)));
}

export function checkClaims(reply: string, receipts: Receipt[], prior: Receipt[] = []): Claim[] {
  const ok = receipts.filter((r) => r.status === 'ok');
  const shells = ok.filter((r) => r.name === 'shell');
  const hasWrite = ok.some((r) => WRITE_TOOLS.has(r.name) || r.name.startsWith('mcp_')) || shells.length > 0;
  const hasRun = shells.length > 0 || ok.some((r) => r.name.startsWith('mcp_'));
  const hasCommit = ok.some((r) => r.name === 'git_commit' || r.name === 'git_push') || shells.some((r) => /\bgit\b[\s\S]*\b(commit|push|merge|tag)\b/.test(String(r.args.command ?? '')) && exitCode(r.output) === 0);
  const hasWeb = ok.some((r) => r.name === 'web_search' || r.name === 'web_fetch');
  const hasRemind = ok.some((r) => r.name === 'remind' && String(r.args.action) === 'set');
  const hasPlanner = ok.some((r) => r.name === 'todo' || r.name === 'note' || r.name.startsWith('mcp_'));
  const hasBrowser = ok.some((r) => BROWSER_TOOLS.has(r.name));
  const hasShot = ok.some((r) => r.name === 'browser_screenshot');
  const testRuns = shells.filter((r) => /\b(test|jest|vitest|pytest|mocha|go test|cargo test|npm t\b|node --test|make check|npm run check)\b/i.test(String(r.args.command ?? '')));

  const claims: Claim[] = [];
  const seen = new Set<string>();
  const add = (kind: ClaimKind, sentence: string, problem: Claim['problem']) => {
    const key = `${kind}:${sentence}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, sentence, problem });
  };

  for (const s of sentences(reply)) {
    if (EARLIER.test(s) || NEGATED.test(s) || I18N.earlier.test(s) || I18N.negated.test(s) || /\?\s*$/.test(s)) continue;
    const artifact = ARTIFACT.test(s) || I18N.artifact.test(s);
    if (I18N.write.test(s) && artifact && !hasWrite && !priorSupports(s, prior, (r) => WRITE_TOOLS.has(r.name) || r.name === 'shell')) add('write', s, 'missing');
    if (I18N.run.test(s) && artifact && !hasRun && !priorSupports(s, prior, (r) => r.name === 'shell' || r.name.startsWith('mcp_'))) add('run', s, 'missing');
    if (I18N.tests.test(s)) {
      if (!testRuns.length && !hasRun) add('tests_pass', s, 'missing');
      else if (testRuns.length && exitCode(testRuns.at(-1)!.output) !== 0) add('tests_pass', s, 'contradicted');
    }
    if (I18N.commit.test(s) && !hasCommit) add('commit', s, 'missing');
    if (I18N.web.test(s) && !hasWeb) add('web', s, 'missing');
    if (I18N.remind.test(s) && !hasRemind) add('remind', s, 'missing');
    else if (I18N.planner.test(s) && !hasPlanner && !hasWrite) add('planner', s, 'missing');
    if (WRITE_VERB.test(s) && ARTIFACT.test(s) && !hasWrite && !priorSupports(s, prior, (r) => WRITE_TOOLS.has(r.name) || r.name === 'shell')) add('write', s, 'missing');
    if (RUN_VERB.test(s) && ARTIFACT.test(s) && !hasRun && !priorSupports(s, prior, (r) => r.name === 'shell' || r.name.startsWith('mcp_'))) add('run', s, 'missing');
    if (TESTS_PASS.test(s)) {
      if (!testRuns.length && !hasRun) add('tests_pass', s, 'missing');
      else if (testRuns.length && exitCode(testRuns.at(-1)!.output) !== 0) add('tests_pass', s, 'contradicted');
    }
    if (COMMIT.test(s) && !hasCommit) add('commit', s, 'missing');
    if (WEB.test(s) && !hasWeb) add('web', s, 'missing');
    if (REMIND.test(s) && !hasRemind) add('remind', s, 'missing');
    else if (PLANNER.test(s) && !hasPlanner && !hasWrite) add('planner', s, 'missing');
    if ((SCREENSHOT.test(s) && !hasShot) || (BROWSER.test(s) && !hasBrowser)) add('browser', s, 'missing');
  }
  return claims;
}

/** Phase 28: the claim judge's labels, as claim kinds. */
export const JUDGE_KINDS: Record<string, ClaimKind> = { FILE: 'write', RUN: 'run', COMMIT: 'commit', WEB: 'web', REMINDER: 'remind', LIST: 'planner' };

/**
 * For the claim judge: is a sentence it picked really a claim this turn's receipts don't back?
 * Uses the same rules as `checkClaims` (earlier work, negations, questions are fine; a shell
 * command can back anything but a commit or passing tests).
 */
export function judgedClaim(sentence: string, kind: ClaimKind, receipts: Receipt[], prior: Receipt[] = []): Claim | undefined {
  if (EARLIER.test(sentence) || NEGATED.test(sentence) || I18N.earlier.test(sentence) || I18N.negated.test(sentence) || /\?\s*$/.test(sentence)) return undefined;
  const ok = receipts.filter((r) => r.status === 'ok');
  const shell = ok.some((r) => r.name === 'shell');
  const mcp = ok.some((r) => r.name.startsWith('mcp_'));
  const backed: Record<ClaimKind, boolean> = {
    write: shell || mcp || ok.some((r) => WRITE_TOOLS.has(r.name)) || priorSupports(sentence, prior, (r) => WRITE_TOOLS.has(r.name) || r.name === 'shell'),
    run: shell || mcp,
    tests_pass: shell || mcp,
    commit: mcp || ok.some((r) => r.name === 'git_push' || r.name === 'git_commit' || (r.name === 'shell' && /\bgit\b[\s\S]*\b(commit|push|merge|tag)\b/.test(String(r.args.command ?? '')))),
    web: mcp || ok.some((r) => r.name === 'web_search' || r.name === 'web_fetch'),
    remind: ok.some((r) => r.name === 'remind'),
    planner: mcp || ok.some((r) => r.name === 'todo' || r.name === 'note' || WRITE_TOOLS.has(r.name)),
    browser: ok.some((r) => BROWSER_TOOLS.has(r.name)),
    action: false,
  };
  return backed[kind] ? undefined : { kind, sentence, problem: 'missing' };
}

export function correctionNote(claims: Claim[]): string {
  const lines = claims.map((c) =>
    c.problem === 'contradicted' ? `- "${c.sentence}": your own tool output says otherwise (the last test run did not exit 0).` : `- "${c.sentence}": no tool did this in this turn.`,
  );
  return `Receipt check failed. Your last reply made claims that the tool log does not support:\n${lines.join('\n')}\nReceipts are the truth. Correct yourself now, briefly and in character: either actually do it with your tools, or say plainly that it didn't happen (or failed). Do not repeat an unsupported claim.`;
}
