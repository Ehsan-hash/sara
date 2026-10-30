// Phase 80 (harness track M5): the sandbox gate on screen. The "Ran in a sandbox" card on the
// approval (what the try did in a throwaway copy: the command, exit code and time, files added /
// changed / removed, anything worth a look, the output) with Apply to my workspace / Discard / Run
// for real, the note on a plain approval when the try comes after your OK (no OS isolation), and a
// short line under her step once you chose. Server data: src/sandbox-run.ts SandboxCard / SandboxRecord.
import { locale, t } from './naming.js';
import { icon } from './icons.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const glyph = (name, cls = 'sbx-icon') => {
  const s = el('span', cls);
  s.setAttribute('aria-hidden', 'true');
  const svg = icon(name);
  if (svg) s.append(svg);
  return s;
};
const secs = (ms) => (Number(ms ?? 0) / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 });

/** What each finding rule says, in the app language (the server's English title is the fallback). */
const RULE_TITLE = {
  'write-outside': () => t('Changed files outside the copy'),
  'outside-blocked': () => t('Tried to write outside the copy (blocked)'),
  'mass-delete': () => t('Deleted many files'),
  'git-hooks': () => t('Wrote git hooks or git settings'),
  'home-files': () => t('Wrote shell or tool settings files'),
  executable: () => t('Created programs or scripts'),
  network: (f) => (/blocked/.test(f.title) ? t('Tried to reach the network (blocked)') : t('Used the network')),
  'process-left': () => t('Left programs running (stopped)'),
  timeout: () => t('Ran out of time (stopped)'),
  'long-runtime': () => t('Took a long time'),
  'not-isolated': () => t('Not isolated on this computer'),
  'deps-missing': () => t('Dependency folders not copied'),
  'too-big': () => t('Too big for a sandbox try'),
};
const RULE_ADVICE = {
  'write-outside': () => t('Something outside its copy changed while it ran. Check these files before you go on.'),
  'outside-blocked': () => t('The sandbox stopped a write outside the copy. A real run would try that on your computer.'),
  'mass-delete': () => t('Applying it deletes these files in your workspace too.'),
  'git-hooks': () => t('Hooks run by themselves on the next commit or checkout. They are never applied to your workspace.'),
  'home-files': () => t('Files like .bashrc or .npmrc change how later commands behave. Look at them before applying.'),
  executable: () => t('New runnable files. Fine for a build; odd for a test run.'),
  network: () => t('It needed the network. Allow network for tries in Settings, or run it for real.'),
  'process-left': () => t('It started programs that kept running after it finished. They were stopped; a real run would leave them going.'),
  timeout: () => t('It ran past the time limit for tries and was stopped.'),
  'long-runtime': () => '',
  'not-isolated': () => t('It ran in a copy without an OS sandbox, so it could still reach other files. Your workspace and the folders around the copy were watched.'),
  'deps-missing': () => t('They stayed out of the copy, so commands that need them may fail here.'),
  'too-big': () => t('Run it for real only if you trust it, or raise the size limit in Settings.'),
};
const SEV_WORD = { block: () => t('blocks'), high: () => t('serious'), medium: () => t('worth a look'), low: () => t('minor'), info: () => t('note') };

/** "Isolated (bubblewrap)" / "Not isolated" chip. */
function isolationChip(card) {
  const chip = el('span', `sbx-chip ${card.isolated ? 'sbx-isolated' : 'sbx-open'}`);
  chip.append(glyph(card.isolated ? 'lock' : 'warn', 'sbx-chip-icon'), el('span', '', card.isolated ? t('Isolated ({how})', { how: { bwrap: 'bubblewrap', seatbelt: t('macOS sandbox'), docker: 'Docker', wsl: 'WSL2' }[card.driver] ?? card.driver }) : t('Not isolated')));
  return chip;
}

/** "+2 ~1 −11" with the file lists folded below. */
function changesBlock(card) {
  const box = el('div', 'sbx-changes');
  const n = card.counts ?? { added: card.added?.length ?? 0, changed: card.changed?.length ?? 0, removed: card.removed?.length ?? 0 };
  const sum = el('p', 'sbx-sum');
  if (!n.added && !n.changed && !n.removed) sum.append(el('span', 'muted', t('No files changed.')));
  else {
    sum.append(el('span', 'sbx-label', t('Files:')));
    if (n.added) sum.append(el('span', 'sbx-add', `+${n.added}`));
    if (n.changed) sum.append(el('span', 'sbx-mod', `~${n.changed}`));
    if (n.removed) sum.append(el('span', 'sbx-del', `−${n.removed}`));
  }
  box.append(sum);
  const lists = [
    ['added', 'sbx-add', '+', t('Added: {n}', { n: n.added })],
    ['changed', 'sbx-mod', '~', t('Changed: {n}', { n: n.changed })],
    ['removed', 'sbx-del', '−', t('Removed: {n}', { n: n.removed })],
  ];
  if (n.added + n.changed + n.removed > 0) {
    const det = el('details', 'sbx-files');
    det.append(el('summary', '', t('Show the files')));
    for (const [k, cls, mark, head] of lists) {
      const items = card[k] ?? [];
      if (!items.length) continue;
      det.append(el('p', 'sbx-list-head small', head));
      const ul = el('ul', 'sbx-list');
      for (const f of items) {
        const li = el('li', cls, `${mark} ${f.path}`);
        li.dataset.raw = '';
        ul.append(li);
      }
      det.append(ul);
    }
    box.append(det);
  }
  return box;
}

/** The findings: one row each (most serious first), with the files or the output line it quotes. */
function findingsBlock(findings) {
  const order = { block: 0, high: 1, medium: 2, low: 3, info: 4 };
  const list = [...(findings ?? [])].sort((a, b) => (order[a.severity] ?? 5) - (order[b.severity] ?? 5));
  if (!list.length) return el('p', 'sbx-clean small', t('Nothing unusual: no writes outside the copy, no programs left running.'));
  const ul = el('ul', 'sbx-findings');
  for (const f of list) {
    const li = el('li', `sbx-finding sev-${f.severity}`);
    const head = el('p', 'sbx-finding-head');
    head.append(glyph(f.severity === 'info' || f.severity === 'low' ? 'dot' : 'warn', 'sbx-finding-icon'), el('strong', '', (RULE_TITLE[f.rule] ?? (() => f.title))(f)), el('span', 'sbx-sev small', (SEV_WORD[f.severity] ?? SEV_WORD.info)()));
    li.append(head);
    const advice = (RULE_ADVICE[f.rule] ?? (() => f.advice))();
    if (advice) li.append(el('p', 'small muted', advice));
    if (f.count && f.rule === 'process-left') li.append(el('p', 'small', t('Programs stopped: {n}', { n: f.count })));
    if (f.files?.length) {
      const files = el('p', 'sbx-finding-files small', f.files.slice(0, 8).join(', ') + (f.files.length > 8 ? ' …' : ''));
      files.dataset.raw = '';
      li.append(files);
    }
    if (f.quote) {
      const q = el('code', 'sbx-quote small', f.quote);
      q.dataset.raw = '';
      li.append(q);
    }
    ul.append(li);
  }
  return ul;
}

/** The approval card's "Ran in a sandbox" section (the buttons are added by the caller). */
export function sandboxSection(card) {
  const box = el('div', `sbx ${card.verdict === 'flagged' ? 'sbx-flagged' : 'sbx-ok'}`);
  const head = el('p', 'sbx-head');
  head.append(glyph('sandbox'), el('strong', '', card.ran ? t('Ran in a sandbox') : t('Not tried in a sandbox')), isolationChip(card));
  box.append(head);
  const cmd = el('pre', 'sbx-cmd', card.command);
  cmd.dataset.raw = '';
  box.append(cmd);
  if (card.ran) {
    const res = card.timedOut ? t('Stopped at the time limit after {s} s', { s: secs(card.ms) }) : t('Exit code {code} · {s} s', { code: card.exitCode ?? '?', s: secs(card.ms) });
    const line = el('p', `sbx-result small ${card.exitCode === 0 && !card.timedOut ? 'sbx-pass' : 'sbx-fail'}`, res);
    box.append(line);
    box.append(changesBlock(card));
  } else if (card.notRun) {
    const why = el('p', 'small', card.notRun);
    why.dataset.raw = '';
    box.append(why);
  }
  box.append(findingsBlock(card.findings));
  if (card.output) {
    const det = el('details', 'sbx-out');
    det.append(el('summary', '', t('Output')));
    const pre = el('pre', '', card.output);
    pre.dataset.raw = '';
    det.append(pre);
    box.append(det);
  }
  if (!card.isolated) box.append(el('p', 'sbx-note small', t('Nothing is applied to your workspace until you choose.')));
  return box;
}

/**
 * Buttons for a sandbox card: Apply to my workspace / Discard / Run for real. `decide(approved, how)`
 * posts the answer (the same approval route as every card).
 */
export function sandboxButtons(card, decide) {
  const row = el('div', 'row sbx-actions');
  const apply = el('button', '', t('Apply to my workspace'));
  apply.type = 'button';
  apply.disabled = !card.ran;
  apply.addEventListener('click', () => decide(true, 'apply'));
  const discard = el('button', 'ghost', t('Discard'));
  discard.type = 'button';
  discard.addEventListener('click', () => decide(false, 'discard'));
  const real = el('button', 'ghost sbx-real', t('Run for real'));
  real.type = 'button';
  real.addEventListener('click', () => {
    // Explicit: the command runs in your real workspace, outside the sandbox.
    if (confirm(t('Run this command for real, in your workspace, outside the sandbox?'))) decide(true, 'real');
  });
  row.append(apply, discard, real);
  return row;
}

/** On a plain approval: the try comes after your OK (no OS isolation on this computer). */
export function sandboxFirstNote(info) {
  const p = el('p', `sbx-first small ${info.isolated ? '' : 'sbx-open'}`);
  p.append(glyph('sandbox'), el('span', '', info.isolated ? t('She tries it in a throwaway copy first and shows you what it did.') : t('She tries it in a throwaway copy first. Not isolated on this computer: the copy could still reach your other files, so it only runs after your OK.')));
  return p;
}

const DECISION_WORDS = {
  applied: () => t('Ran in a sandbox, then you applied it'),
  'auto-applied': () => t('Ran in a sandbox: clean, applied by itself'),
  discarded: () => t('Ran in a sandbox: you discarded it'),
  ran: () => t('Ran in a sandbox, then you ran it for real'),
  cancelled: () => t('Ran in a sandbox: cancelled'),
};

/** The short line under her step once you chose (also rebuilt from the stored tool message). */
export function sandboxFlag(rec) {
  const box = el('div', `sbx-flag ${rec.verdict === 'flagged' ? 'sbx-flagged' : 'sbx-ok'}`);
  box.dataset.call = rec.callId ?? '';
  const body = el('div', 'sbx-flag-body');
  body.append(el('span', 'sbx-flag-head', (DECISION_WORDS[rec.decision] ?? DECISION_WORDS.cancelled)()));
  const n = rec.counts ?? { added: 0, changed: 0, removed: 0 };
  const files = n.added || n.changed || n.removed ? `+${n.added} ~${n.changed} −${n.removed}` : t('no files changed');
  body.append(el('span', 'small muted', files));
  if (rec.applied) body.append(el('span', 'small muted', t('Written: {w} · removed: {r}', { w: rec.applied.written?.length ?? 0, r: rec.applied.removed?.length ?? 0 })));
  if (rec.applied?.conflicts?.length) body.append(el('span', 'small sbx-warn', t('Left alone (changed meanwhile): {files}', { files: rec.applied.conflicts.slice(0, 5).join(', ') })));
  const serious = (rec.findings ?? []).filter((f) => f.severity === 'high' || f.severity === 'block' || f.severity === 'medium');
  for (const f of serious.slice(0, 3)) body.append(el('span', 'small sbx-warn', (RULE_TITLE[f.rule] ?? (() => f.title))(f)));
  box.append(glyph('sandbox'), body);
  return box;
}

/** Team page: the helper's sandbox card in its approval row (Apply / Discard / Run for real). */
export function teamSandboxRow(ap, decide) {
  const wrap = el('div', 'team-sbx');
  wrap.append(sandboxSection(ap.sandbox), sandboxButtons(ap.sandbox, decide));
  return wrap;
}
