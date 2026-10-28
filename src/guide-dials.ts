// The dial tables of the guide (web/help.html, between <!-- dials:start --> and <!-- dials:end -->),
// built from the definitions in traits.ts. scripts/gen-guide.ts writes them; a test checks the
// guide matches, so it never drifts from the app.
import { HUMOURS, QUIET_FOCUS, TRAITS } from './traits.ts';
import { ARCHETYPES } from './studio.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const GROUPS: [string, string][] = [
  ['Heart', 'Heart'],
  ['Fun', 'Fun'],
  ['Edge', 'Edge'],
  ['Talk', 'Talk'],
  ['Together', 'You and her (Settings → Relationship)'],
  ['Work', 'At work (coding conversations only)'],
];

export const DIALS_START = '<!-- dials:start -->';
export const DIALS_END = '<!-- dials:end -->';

export function dialTablesHtml(): string {
  let h = '';
  for (const [g, title] of GROUPS) {
    h += `<h3>${esc(title)}</h3>\n<table class="guide-dials">\n<tr><th>Dial</th><th>Low</th><th>Middle</th><th>High</th></tr>\n`;
    for (const t of TRAITS.filter((x) => x.group === g)) {
      h += `<tr id="dial-${t.id}"><td><b>${esc(t.label)}</b><br><span class="muted small">${esc(t.low)} ↔ ${esc(t.high)}</span></td><td>${esc(t.examples[0])}</td><td>${esc(t.examples[1])}</td><td>${esc(t.examples[2])}</td></tr>\n`;
    }
    h += '</table>\n';
    if (g === 'Work') h += `<p id="dial-${QUIET_FOCUS.id}"><b>${esc(QUIET_FOCUS.label)}</b> (a switch): ${esc(QUIET_FOCUS.tip)}</p>\n`;
  }
  h += `<p><b>Humour styles:</b> ${Object.values(HUMOURS).map((x) => esc(x.label)).join(', ')}.</p>\n`;
  h += `<p><b>Starting points:</b> ${ARCHETYPES.map((a) => `${a.emoji} ${esc(a.label)} (${esc(a.blurb.replace(/\.$/, ''))})`).join('; ')}.</p>\n`;
  return h;
}

/** The guide with its dial tables replaced (or the same text when they already match). */
export function withDialTables(html: string): string {
  const a = html.indexOf(DIALS_START);
  const b = html.indexOf(DIALS_END);
  if (a < 0 || b < a) throw new Error('help.html has no dials markers');
  return `${html.slice(0, a + DIALS_START.length)}\n${dialTablesHtml()}${html.slice(b)}`;
}
