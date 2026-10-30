// Phase 85 (harness M10): "Remembered on her own". A recall trigger (src/triggers.ts) put a short,
// sourced note into her next model call: the same error fixed before in this project, a command that
// failed here last time, a file you have a note about, a task like one that left a lesson, a package
// a lesson is about. Each note shows as a chip under her step (and in her panel): what came to mind,
// where from (run and date), the why/sure line in the same words as "She remembered", and
// "Not useful", which halves that trigger's weight (POST /api/memory/recall/feedback).
import { locale, t } from './naming.js';
import { icon } from './icons.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const KIND = {
  error: () => t('the same error before'),
  command: () => t('a command that failed before'),
  file: () => t('a note about this file'),
  task: () => t('a similar task'),
  package: () => t('a package with a lesson'),
};
/** The words for a trigger kind ("the same error before"), also used by the step line. */
export const recallKindWords = (kind) => (KIND[kind] ?? KIND.task)();
const SURE = { high: () => t('Sure: high'), medium: () => t('Sure: medium'), low: () => t('Sure: low') };

const day = (d) => {
  if (!d) return '';
  const x = new Date(`${d}T12:00:00`);
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Where the note came from, in words: "run 12 · 28 Oct 2026". */
export function recallSource(item) {
  const s = item?.source ?? {};
  return [s.runId ? t('run {n}', { n: s.runId }) : '', day(s.date)].filter(Boolean).join(' · ');
}

/**
 * One chip. `api(path, {method, body})` posts the feedback; `messageId` is the reply that carried the
 * note (so the chip stays marked after a reload); live chips get it on the redraw after the turn.
 */
export function recallChip(item, { api, messageId, compact = false } = {}) {
  const box = el('div', `recall-chip${compact ? ' recall-compact' : ''}`);
  box.dataset.ref = item.ref ?? '';
  box.dataset.kind = item.kind ?? '';
  const ic = el('span', 'recall-icon');
  ic.setAttribute('aria-hidden', 'true');
  const svg = icon('recall');
  if (svg) ic.append(svg);
  const body = el('div', 'recall-body');
  const head = el('span', 'recall-head', t('Remembered on her own'));
  const kind = el('span', 'recall-kind muted small', KIND[item.kind]?.() ?? '');
  const txt = el('span', 'recall-text', item.text ?? '');
  txt.dataset.raw = '';
  const why = el('span', 'recall-why muted small', `[${t('why')}: ${item.why ?? ''}; ${SURE[item.sure]?.() ?? ''}]`);
  why.dataset.raw = '';
  const src = el('span', 'recall-src muted small', recallSource(item));
  body.append(head, kind, txt, why, src);
  const row = el('div', 'recall-actions');
  const no = el('button', 'linkish small recall-no', item.feedback === 'not-useful' ? t('Marked not useful') : t('Not useful'));
  no.type = 'button';
  no.title = t('She will bring this up less often. Nothing is deleted.');
  no.disabled = item.feedback === 'not-useful' || !api;
  no.addEventListener('click', async () => {
    no.disabled = true;
    try {
      await api('/memory/recall/feedback', { method: 'POST', body: { kind: item.kind, ref: item.ref, ...(messageId || item.messageId ? { messageId: messageId ?? item.messageId } : {}) } });
      item.feedback = 'not-useful';
      no.textContent = t('Marked not useful');
      box.classList.add('recall-dismissed');
    } catch {
      no.disabled = false;
    }
  });
  row.append(no);
  body.append(row);
  if (item.feedback === 'not-useful') box.classList.add('recall-dismissed');
  box.append(ic, body);
  return box;
}
