// Phase 53: the web app in Spanish, French, German, Portuguese (Brazil) and Italian, and she talks in
// the owner's language. Every user-visible English string must be translated in every language, so a
// new string without translations fails here (run `node scripts/i18n-extract.ts` to see which).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LANGS, SAME_OK, allKeys, fromTips, loadLang, placeholders, report } from '../scripts/i18n-extract.ts';
import { DISCLOSURES, appLanguage, detectLanguage, disclosureIn, languageLine, talkLanguage, toLang, voiceLanguage } from '../src/i18n.ts';
import { buildSystemPrompt, loadPersona } from '../src/persona.ts';
import { disclosureText } from '../src/safety.ts';
import { ROOT, tempDir } from './helpers.ts';

const tags = (s: string) => [...s.matchAll(/<\/?\w+[^>]*>|<_\/>/g)].map((m) => m[0]).sort().join('');

test('i18n: every language has every key, no unused keys, placeholders kept', () => {
  const r = report();
  assert.ok(r.keys > 1500, `found ${r.keys} strings; the extractor lost some`);
  for (const l of r.langs) {
    assert.deepEqual(l.missing.slice(0, 5), [], `${l.lang}: ${l.missing.length} strings not translated (node scripts/i18n-extract.ts)`);
    assert.deepEqual(l.unused.slice(0, 5), [], `${l.lang}: ${l.unused.length} translations nobody uses`);
    assert.deepEqual(l.badPlaceholders.slice(0, 5), [], `${l.lang}: {placeholders} changed`);
  }
});

test('i18n: translations differ from English unless the word is meant to stay', () => {
  const keys = allKeys();
  for (const lang of LANGS) {
    const d = loadLang(lang);
    const same = new Set((d['@same'] as unknown as string[]) ?? []);
    assert.ok(same.size <= 60, `${lang}: ${same.size} strings left in English on purpose; translate them`);
    for (const k of same) {
      assert.ok(keys.has(k), `${lang}: @same lists an unknown string: ${k}`);
      assert.ok(k.split(/\s+/).length <= 6, `${lang}: a whole sentence is left in English: ${k}`);
    }
    for (const k of keys.keys()) {
      const v = d[k];
      if (v === k) assert.ok(SAME_OK.test(k) || same.has(k), `${lang}: "${k.slice(0, 60)}" is still English (translate it or list it in @same)`);
      // HTML (help page items) and code placeholders survive translation.
      assert.equal(tags(String(v)), tags(k), `${lang}: markup changed in "${k.slice(0, 60)}"`);
      assert.deepEqual(placeholders(String(v)), placeholders(k));
    }
  }
});

test('i18n: translated tips stay short enough for the ? popups', () => {
  const tips = fromTips(readFileSync(join(ROOT, 'web', 'tips.json'), 'utf8'));
  for (const lang of LANGS) {
    const d = loadLang(lang);
    for (const k of tips) assert.ok(String(d[k]).length <= Math.max(260, k.length), `${lang} tip too long (${String(d[k]).length}): ${d[k].slice(0, 60)}`);
  }
});

test('i18n: safety texts keep their meaning (988 stays US-only, adult mode stays 18+)', () => {
  const keys = [...allKeys().keys()];
  for (const lang of LANGS) {
    const d = loadLang(lang);
    for (const k of keys) {
      const v = String(d[k]);
      // Numbers (crisis lines, ages, limits) are never invented or changed.
      const nums = (s: string) => (s.match(/\b(988|18)\b/g) ?? []).sort().join();
      assert.equal(nums(v), nums(k), `${lang}: a safety number changed in "${k.slice(0, 70)}"`);
    }
  }
});

test('i18n: the AI disclosure exists in every language with the same parts', () => {
  for (const [lang, text] of Object.entries(DISCLOSURES)) {
    assert.match(text, /^\{name\} /, lang);
    assert.ok(text.length > 60, lang);
  }
  assert.match(disclosureText('Mia', 'es'), /^Mia es una IA de compañía, no un ser humano\./);
  assert.match(disclosureText('Mia', 'de'), /^Mia ist eine KI-Begleitung, kein Mensch\./);
  assert.match(disclosureText('Mia', 'fr'), /^Mia est une IA de compagnie, pas un être humain\./);
  assert.match(disclosureText('Mia', 'pt-BR'), /^Mia é uma IA de companhia, não um ser humano\./);
  assert.match(disclosureText('Mia', 'it'), /^Mia è un’IA di compagnia, non un essere umano\./);
  assert.equal(disclosureText('Sara', 'en'), disclosureIn('Sara', 'xx'), 'unknown language → English');
  assert.match(disclosureText('Sara'), /^Sara is an AI companion, not a human\./);
});

test('i18n: app language, talk language and the prompt line', () => {
  assert.equal(toLang('de-AT'), 'de');
  assert.equal(toLang('pt'), 'pt-BR');
  assert.equal(toLang('es-419'), 'es');
  assert.equal(toLang('ja'), undefined);
  assert.equal(appLanguage({}), 'en');
  assert.equal(appLanguage({ language: 'auto', languageDetected: 'fr-FR' }), 'fr');
  assert.equal(appLanguage({ language: 'it', languageDetected: 'fr' }), 'it');
  // Automatic talk language: the language the owner writes in, else the app language.
  assert.equal(talkLanguage({ language: 'de' }, 'Hola, ¿qué tal estás hoy? Tengo una pregunta para ti.'), 'es');
  assert.equal(talkLanguage({ language: 'de' }, 'ok'), 'de', 'too short to tell');
  assert.equal(talkLanguage({ language: 'de' }, 'Hey, how are you doing today? I have a question for you.'), 'en');
  assert.equal(talkLanguage({ talkLanguage: 'fr' }, 'Hola, ¿qué tal estás hoy?'), 'fr', 'a fixed pick wins');
  assert.equal(detectLanguage('Ich bin heute sehr müde, aber es ist gut.'), 'de');
  assert.equal(detectLanguage('Oi, tudo bem? Eu estou muito feliz hoje com você.'), 'pt-BR');
  assert.equal(detectLanguage('Ciao, come stai? Io sono molto contento oggi.'), 'it');
  assert.equal(detectLanguage("Bonjour, je suis très content aujourd'hui, merci."), 'fr');
  assert.equal(voiceLanguage('es'), 'es-MX');
  assert.equal(voiceLanguage('de'), 'de');
  // The prompt line only when she isn't speaking English; her character stays the same.
  assert.equal(languageLine('en'), undefined);
  assert.equal(languageLine(undefined), undefined);
  assert.match(languageLine('de')!, /^Reply in German unless asked otherwise\./);
  const persona = loadPersona(join(ROOT, 'persona', 'sara.json'));
  const ctx = { now: new Date('2026-10-27T15:00:00Z'), ownerName: 'Alex' };
  const en = buildSystemPrompt(persona, ctx);
  const de = buildSystemPrompt(persona, { ...ctx, language: languageLine('de') });
  assert.doesNotMatch(en, /## Language/);
  assert.match(de, /## Language\nReply in German unless asked otherwise\./);
  assert.equal(de.replace(/\n\n## Language\n[^\n]*/, ''), en, 'only the language line differs');
});

// The browser module, run with tiny stand-ins for the page (no DOM needed for t()).
interface Naming {
  t: (s: string, vars?: Record<string, unknown>) => string;
  setIdentity: (i: { name: string; pronouns: string }) => void;
  setLanguage: (code: string) => Promise<string>;
  currentLang: () => string;
}
async function loadNaming(): Promise<Naming> {
  const g = globalThis as Record<string, unknown>;
  g.Node ??= { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  g.NodeFilter ??= { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  g.MutationObserver ??= class { observe() {} disconnect() {} };
  const store = new Map<string, string>();
  g.localStorage ??= { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  g.document ??= { documentElement: { lang: 'en' }, body: { nodeType: 3, nodeValue: '', parentElement: null }, title: '', querySelector: () => null };
  g.fetch = async (url: string) => {
    const lang = /\/i18n\/(.+)\.json$/.exec(String(url))?.[1];
    return new Response(readFileSync(join(ROOT, 'web', 'i18n', `${lang}.json`)), { status: 200 });
  };
  // naming.js imports the shared identity module, which the server serves from src/identity.ts.
  const src = readFileSync(join(ROOT, 'web', 'naming.js'), 'utf8').replace("'./identity.js'", JSON.stringify(pathToFileURL(join(ROOT, 'src', 'identity.ts')).href));
  const tmp = tempDir();
  const file = join(tmp.dir, 'naming.mjs');
  writeFileSync(file, src);
  try {
    return (await import(pathToFileURL(file).href)) as Naming;
  } finally {
    tmp.cleanup();
  }
}

test('i18n: t() translates first, then puts in her name (pronouns only in English)', async () => {
  const n = await loadNaming();
  n.setIdentity({ name: 'Max', pronouns: 'he' });
  // English: name and pronouns are rewritten.
  assert.equal(n.t('Wait for her reply first.'), 'Wait for his reply first.');
  assert.equal(n.t('Say hi to Sara.'), 'Say hi to Max.');
  await n.setLanguage('de');
  assert.equal(n.currentLang(), 'de');
  assert.equal((globalThis as unknown as { document: { documentElement: { lang: string } } }).document.documentElement.lang, 'de');
  assert.equal(n.t('Say hi to Sara.'), 'Sag Hallo zu Max.');
  // Placeholders are filled after translating and personalizing: owner text is never rewritten.
  assert.equal(n.t('Show only #{tg} ({n})', { tg: 'Sara', n: 2 }), 'Nur #Sara zeigen (2)');
  // Unknown strings stay English (and the name still follows).
  assert.equal(n.t('Sara made this up just now'), 'Max made this up just now');
  await n.setLanguage('es');
  assert.equal(n.t('Wait for her reply first.'), 'Espera primero su respuesta.', 'no English pronoun rewriting in Spanish');
  await n.setLanguage('en');
  assert.equal(n.t('Wait for her reply first.'), 'Wait for his reply first.');
});
