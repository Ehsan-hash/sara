# Translating Sara

The web app (and so the phone and desktop apps, which load the same pages) speaks English plus
Spanish (`es`), French (`fr`), German (`de`), Portuguese (Brazil) (`pt-BR`) and Italian (`it`).
This page is for anyone who wants to fix a word, keep a language complete, or add a new one.

## How it works

- **English is the source.** Every built-in string is written in English in `web/index.html`,
  `web/*.js` and `web/tips.json`.
- **One file per language:** `web/i18n/<lang>.json`, a flat object keyed by the English text itself
  (trimmed, spaces collapsed). There is no build step and no list of made-up key names to keep in
  sync. If the English changes, the old key shows up as unused and the new one as missing, so you
  can see exactly what to update.
- In the browser, `web/naming.js` swaps text nodes and the `placeholder`, `title`, `aria-label`,
  `alt` and `data-tip` attributes. Code builds text with `t('English text', { name: … })`.
- **Translate first, then personalize.** In English, `personalize()` rewrites "Sara/she/her" to the
  companion's name and pronouns. Pronoun rules don't carry over to other languages (German "sie" is
  also "they", Spanish drops the subject, adjectives agree in gender), so in other languages only
  the name is swapped. **Write translations with the name "Sara" or neutral wording, not with
  pronouns for her.** Example: German "Sara antwortet…" rather than "Sie antwortet…".
- Text the owner or the companion wrote (messages, memories, notes, titles, look backs) is never
  translated.
- Server-made text (errors, most notices) is still English, except the AI disclosure, which is
  legally required and lives in `src/i18n.ts` (`DISCLOSURE`) in every language.

## The rules

- **Keep placeholders:** `{name}`, `{n}`, `{date}`… must appear in the translation exactly as in the
  English (you can move them).
- **Keep markup** in help page items (`<strong>`, `<em>`, `<a href>`, `<code>`) and the `<_/>`
  marker (it stands for a code sample that isn't translated).
- **Keep untranslated:** product names (Sara, Grok, Ollama, ChatGPT, Claude, GitHub, Telegram,
  Discord…), commands, code, file names, settings that are typed in English, and the companion's
  name.
- **Safety and legal texts keep their exact meaning:** the AI disclosure, the crisis resources
  (988 is a US number: keep the text's meaning, never add local numbers), and the Adult mode 18+
  confirmation. The test checks that the numbers 988 and 18 are never changed or added.
- Use the friendly "you" form (tú / tu / du / você / tu) and the same word for the same thing
  across the whole file (look at how Settings pages and buttons are named).
- Tips (the `?` popups) should stay at most 260 characters (or as long as the English).
- Words that really are the same in your language (for example German "Team") go in the
  `"@same"` list at the top of the file, so the test knows they're left in English on purpose.

## Checking a language

```
node scripts/i18n-extract.ts                # counts per language: missing, unused, wrong {placeholders}
node scripts/i18n-extract.ts --missing de   # the missing keys of one language, as JSON to fill in
node scripts/i18n-extract.ts --keys         # every key
node --test test/i18n.test.ts               # the same checks the full test suite runs
```

The test fails when any language misses a key, keeps a stale key, changes a placeholder or markup,
leaves a sentence in English, or makes a tip too long. So a new English string needs its
translations in the same change.

New strings built from data (the server's mood words, one-word labels in label maps) that the
extractor can't see go in `web/i18n/_extra.json` (`keys`).

## Adding a language

1. Add the code to `LANGUAGES` / `LANGUAGE_NAMES` / `MARKERS` / `DISCLOSURE` in `src/i18n.ts`, to
   `LANGS` in `scripts/i18n-extract.ts` and in `web/naming.js`, and to the two pickers in
   `web/index.html` (Settings → You → Language and Talk to me in).
2. Start the file: `node scripts/i18n-extract.ts --missing xx > web/i18n/xx.json`, add
   `"@language"` and `"@same"` at the top, and translate every value.
3. Run the checks above until they pass, then the whole suite (`npm run check`).
4. Look at the app in the new language at desktop and phone width (long words wrap or get cut off
   in the sidebar and buttons; pick shorter words where needed).

The help page (`web/help.html`) translates its menu, headings, opening line and "Getting started"
(`web/help-i18n.js`); the rest of the guide is English for now.
