// Phase 83 (harness track M8): time-travel. \"Branch from here\" on a step of the Run view opens
// this sheet: change her message, a result she saw, the notes she remembered or the model, then
// \"Run the branch\" (or \"Replay unchanged\", the control). She carries on from that step live,
// shown on the same step line as a chat reply, with the same approval cards. Then the two runs side
// by side: steps, tokens and cost, tool calls, files, the answers word by word, the notes. The
// branch's answer goes into the conversation only with \"Use this answer\"; its files reach your
// project only with \"Apply\". Desktop: a window; phone: a full-screen sheet (look.css).
import { locale, serverText, t } from './naming.js';
import { icon } from './icons.js';
import { addStep, finishStep, fmtDuration, runStep, stepLine, waitStep } from './steps.js';
import { sandboxButtons, sandboxSection } from './sandbox-view.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const glyph = (name, cls = 'run-icon') => {
  const s = el('span', cls);
  s.setAttribute('aria-hidden', 'true');
  const svg = icon(name) ?? icon('branch');
  if (svg) s.append(svg);
  return s;
};
const btn = (label, cls = '', iconName = '') => {
  const b = el('button', cls);
  b.type = 'button';
  if (iconName) b.append(glyph(iconName, 'br-btn-icon'));
  b.append(el('span', '', label));
  return b;
};
const nf = (n, d = 0) => Number(n ?? 0).toLocaleString(locale(), { maximumFractionDigits: d });
const tokens = (n) => (n >= 10_000 ? `${nf(n / 1000, 1)}k` : nf(n));
const said = (x) => (x && typeof x === 'object' ? t(x.key, x.params) : t(String(x ?? '')));
const $ = (sel) => document.querySelector(sel);

const CHANGE = { added: () => t('added'), changed: () => t('changed'), removed: () => t('removed'), unchanged: () => t('unchanged') };
const STATUS = { ok: () => t('finished'), error: () => t('ended with an error'), stopped: () => t('stopped'), running: () => t('still running'), budget: () => t('stopped at its budget'), interrupted: () => t('cut off by a restart') };

/** A branch's edits (the server's short words) in the app's language. */
export function editWords(list = []) {
  if (!list.length) return [t('nothing changed (a control run)')];
  return list.map((w) => {
    if (w === 'message') return t('your message changed');
    if (w.startsWith('tool:')) return t('a tool result changed');
    if (w.startsWith('note-out:')) return t('note #{id} taken out', { id: w.slice(9) });
    if (w.startsWith('note-in:')) return t('note #{id} put in', { id: w.slice(8) });
    if (w.startsWith('model:')) return t('model: {model}', { model: w.slice(6).split('/').slice(1).join('/') });
    return w;
  });
}

/** The summary line in words: \"3 fewer steps · 40% fewer tokens · different edits in x.ts · a different answer\". */
export function summaryWords(s) {
  const parts = [];
  const dSteps = s.stepsB - s.stepsA;
  parts.push(dSteps === 0 ? t('the same number of steps') : dSteps < 0 ? t('{n} fewer steps', { n: -dSteps }) : t('{n} more steps', { n: dSteps }));
  if (s.tokensA > 0) {
    const pct = Math.round(((s.tokensB - s.tokensA) / s.tokensA) * 100);
    parts.push(pct === 0 ? t('about the same tokens') : pct < 0 ? t('{n}% fewer tokens', { n: -pct }) : t('{n}% more tokens', { n: pct }));
  }
  if (s.filesDiffer.length) parts.push(t('different file edits in {files}', { files: s.filesDiffer.slice(0, 3).join(', ') + (s.filesDiffer.length > 3 ? ` +${s.filesDiffer.length - 3}` : '') }));
  parts.push(s.sameAnswer ? t('the same answer') : t('a different answer'));
  return parts.join(' · ');
}

const usdWords = (usd, unknown) => (unknown ? t('cost unknown') : usd > 0 ? `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}` : t('local'));

/** Reads a server-sent-events response, calling `on(ev)` for each event. */
async function readEvents(res, on) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (line) on(JSON.parse(line.slice(6)));
    }
  }
}

function sheet() {
  const dlg = $('#branch-sheet');
  if (!dlg.open) dlg.showModal();
  return dlg;
}

function show(part) {
  for (const id of ['#br-edit', '#br-live', '#br-diff']) $(id).hidden = id !== part;
}

/**
 * Opens the branch sheet for one step of a run. `ctx`: { api, named, openRun(id) }.
 */
export async function openBranchSheet(run, step, ctx) {
  sheet();
  show('#br-edit');
  $('#br-title').textContent = t('Branch from step {n}', { n: step.idx + 1 });
  const exact = $('#br-exact');
  exact.className = 'small';
  exact.textContent = t('Loading…');
  let info;
  try {
    info = await ctx.api(`/runs/${run.id}/steps/${step.idx}/branch`);
  } catch (err) {
    exact.className = 'small run-err';
    exact.textContent = err.message;
    $('#br-run').disabled = true;
    $('#br-same').disabled = true;
    return;
  }
  $('#br-run').disabled = false;
  $('#br-same').disabled = false;
  exact.textContent = info.exact === true ? t('Rebuilt exactly as it was sent.') : info.exact === false ? t('Rebuilt, but something it saw has changed since:') : t('Rebuilt from the record (recorded before exact checks existed).');
  exact.classList.toggle('br-warn', info.exact === false);
  for (const p of info.problems ?? []) exact.append(el('span', 'br-problem', ` ${said(p)}`));
  const prompt = $('#br-prompt');
  prompt.value = info.message ?? '';
  prompt.disabled = info.message === null;
  // A result she saw (from the steps before this one).
  const tool = $('#br-tool');
  tool.replaceChildren(new Option(t('Keep every result as it was'), ''));
  for (const x of info.tools) tool.append(new Option(t('Step {n}: {what}', { n: x.step + 1, what: x.summary || x.name }), x.callId));
  tool.disabled = !info.tools.length;
  const toolRow = $('#br-tool-row');
  const toolOut = $('#br-tool-out');
  toolRow.hidden = true;
  tool.onchange = () => {
    const x = info.tools.find((y) => y.callId === tool.value);
    toolRow.hidden = !x;
    toolOut.value = x?.output ?? '';
  };
  // The notes she remembered: ticked = kept in.
  const notes = $('#br-notes');
  notes.replaceChildren();
  if (!info.notes.length) notes.append(el('p', 'muted small', t('No notes went in at this step.')));
  for (const n of info.notes) {
    const row = el('label', 'br-note');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = true;
    box.value = String(n.id);
    row.append(box, el('span', 'br-note-id', t('Note #{id}', { id: n.id })), el('span', 'br-note-text', n.text ?? t('(this note is gone)')));
    notes.append(row);
  }
  $('#br-note-add').value = '';
  // Models (pick-list): the step's own first.
  const model = $('#br-model');
  model.replaceChildren();
  for (const m of info.models) model.append(new Option(m.label, `${m.providerId}\u0000${m.model}`));
  const rec = `${info.model.providerId}\u0000${info.model.model}`;
  if ([...model.options].some((o) => o.value === rec)) model.value = rec;
  // Where the files are.
  const ws = $('#br-ws');
  ws.textContent = info.coding ? (info.workspace?.head ? t('She works in a copy of your project at commit {head}; your files stay as they are until you choose Apply.', { head: info.workspace.head.slice(0, 10) }) : t('She works in a copy of your project; your files stay as they are until you choose Apply.')) : t('Her tools work in a copy of the workspace; your files stay as they are until you choose Apply.');
  const go = (unchanged) => {
    const edits = {};
    if (!unchanged) {
      if (!prompt.disabled && prompt.value !== (info.message ?? '')) edits.message = prompt.value;
      const x = info.tools.find((y) => y.callId === tool.value);
      if (x && toolOut.value !== x.output) edits.toolResults = [{ callId: x.callId, output: toolOut.value }];
      const exclude = [...notes.querySelectorAll('input:not(:checked)')].map((b) => Number(b.value));
      const add = Number($('#br-note-add').value);
      const include = Number.isInteger(add) && add > 0 ? [add] : [];
      if (exclude.length || include.length) edits.memory = { exclude, include };
      if (model.value && model.value !== rec) {
        const [providerId, m] = model.value.split('\u0000');
        edits.model = { providerId, model: m };
      }
    }
    void runBranch(run, step, edits, ctx);
  };
  $('#br-run').onclick = () => go(false);
  $('#br-same').onclick = () => go(true);
}

/** Runs the branch: the live step line, approval cards, then the diff. */
async function runBranch(run, step, edits, ctx) {
  show('#br-live');
  const live = $('#br-live');
  const head = el('p', 'br-live-head');
  head.append(glyph('branch'), el('strong', '', t('Running the branch…')));
  const notes = el('div', 'br-notes-live small');
  const box = stepLine({ named: ctx.named });
  box.open = true;
  const reply = el('p', 'br-reply');
  const cards = el('div', 'br-cards');
  const status = el('p', 'muted small', t('Models don\'t answer the same way twice: a difference may be chance, not your change.'));
  const stop = btn(t('Stop'), 'ghost');
  stop.disabled = true;
  live.replaceChildren(head, notes, box, cards, reply, status, stop);
  let branchId = 0;
  let failed = '';
  stop.onclick = () => branchId && void ctx.api(`/runs/${branchId}/stop`, { method: 'POST', body: {} }).catch(() => {});
  let res;
  try {
    res = await ctx.api(`/runs/${run.id}/branch`, { method: 'POST', body: { fromStep: step.idx, edits }, raw: true });
    if (!res.ok) throw new Error(serverText(await res.json().catch(() => ({})), `HTTP ${res.status}`));
  } catch (err) {
    head.replaceChildren(glyph('warn'), el('strong', 'run-err', err.message));
    live.append(backButton(run, step, ctx));
    return;
  }
  await readEvents(res, (ev) => {
    if (ev.type === 'branch') {
      branchId = ev.runId;
      stop.disabled = false;
      const ws = ev.workspace;
      if (ws) {
        notes.append(el('p', '', ws.strategy === 'clone' ? t('Copy of your project at commit {head}.', { head: String(ws.head ?? '').slice(0, 10) }) : t('Copy of the workspace as it is now.')));
        for (const n of ws.notes ?? []) notes.append(el('p', 'muted', said(n)));
        if (ws.notRestored?.length) notes.append(el('p', 'br-warn', t("Couldn't be restored as it was: {files}", { files: ws.notRestored.map((x) => `${x.path} (${t(x.why)})`).join(', ') })));
      }
      notes.append(el('p', 'muted', t('In a branch, Apply and Run for real on a sandbox card act on the copy, not your project.')));
    } else if (ev.type === 'token') reply.textContent += ev.text;
    else if (ev.type === 'replace') reply.textContent = ev.text;
    else if (ev.type === 'tool_call') {
      reply.textContent = '';
      addStep(box, { id: ev.id, name: ev.name, summary: ev.summary, args: ev.args });
    } else if (ev.type === 'tool_running') runStep(box, ev.id);
    else if (ev.type === 'tool_result') finishStep(box, { id: ev.id, status: ev.status, output: ev.output, ms: ev.ms });
    else if (ev.type === 'approval') {
      waitStep(box, ev.id);
      cards.append(approvalCard(ev, ctx));
    } else if (ev.type === 'notice') status.before(el('p', 'br-notice small', ev.text));
    else if (ev.type === 'error') failed = ev.message;
    else if (ev.type === 'branch_done') {
      stop.disabled = true;
      head.replaceChildren(glyph('check'), el('strong', '', t('The branch finished: {status}', { status: STATUS[ev.outcome.status]?.() ?? ev.outcome.status })));
    }
  }).catch((err) => {
    failed = err.message;
  });
  stop.remove();
  if (failed) status.before(el('p', 'run-err small', serverText({ error: failed }, failed)));
  if (branchId) await openDiffSheet(run.id, branchId, ctx, { back: () => openBranchSheet(run, step, ctx) });
}

function backButton(run, step, ctx) {
  const b = btn(t('Back to the changes'), 'ghost');
  b.onclick = () => openBranchSheet(run, step, ctx);
  return b;
}

/** An approval card inside the branch (the same answers as in a chat). */
function approvalCard(ev, ctx) {
  const card = el('div', 'br-approval');
  const decide = async (approved, how) => {
    for (const b of card.querySelectorAll('button')) b.disabled = true;
    try {
      await ctx.api(`/approvals/${ev.approvalId}`, { method: 'POST', body: { approved, ...(how ? { how } : {}) } });
      card.append(el('p', 'muted small', approved ? t('You allowed it.') : t('You said no.')));
    } catch (err) {
      card.append(el('p', 'run-err small', err.message));
    }
  };
  card.append(el('p', 'br-approval-q', ev.name === 'budget' ? t('The branch reached its budget: keep going?') : t('She wants to: {what}', { what: ev.summary })));
  if (ev.contradiction) card.append(el('p', 'run-contra small', t('This goes against something you decided: “{note}”', { note: ev.contradiction.note ?? '' })));
  if (ev.sandbox) {
    card.append(sandboxSection(ev.sandbox), sandboxButtons(ev.sandbox, decide));
    return card;
  }
  const row = el('div', 'row');
  const yes = btn(ev.contradiction ? t('Do it anyway') : t('Allow'), '');
  yes.onclick = () => decide(true, ev.contradiction ? 'override' : undefined);
  const no = btn(ev.contradiction ? t("Don't") : t('Deny'), 'ghost');
  no.onclick = () => decide(false, ev.contradiction ? 'deny' : undefined);
  row.append(yes, no);
  card.append(row);
  return card;
}

/** One side of a step in the diff. */
function sideCell(s, named) {
  const c = el('div', 'br-cell');
  if (!s) {
    c.append(el('p', 'muted small', t('No step here')));
    return c;
  }
  c.append(el('p', 'small br-cell-meta', [s.model ?? '', `${tokens(s.tokensIn)} ${t('in')} · ${tokens(s.tokensOut)} ${t('out')}`, usdWords(s.usd, s.costUnknown), s.ms ? fmtDuration(s.ms) : ''].filter(Boolean).join(' · ')));
  if (s.stopped) c.append(el('span', 'run-chip warn', s.stopped));
  for (const x of s.tools) {
    const d = el('details', `br-tool ${x.status}`);
    const sum = el('summary', 'small');
    sum.append(el('code', '', x.name === 'shell' ? String(x.args?.command ?? x.summary) : x.summary || named(x.name) || x.name), el('span', `run-chip ${x.status === 'ok' ? 'ok' : 'bad'}`, x.status === 'ok' ? t('done') : x.status === 'denied' ? t('not run') : t('failed')));
    const out = el('pre', 'run-out', x.output || t('(no output)'));
    out.dataset.raw = '';
    d.append(sum, out);
    c.append(d);
  }
  if (!s.tools.length) c.append(el('p', 'muted small', t('Answered')));
  return c;
}

/** The word diff of the two answers: removed words struck through, added words marked. */
function answerDiff(ops) {
  const p = el('p', 'br-words');
  p.dataset.raw = '';
  for (const o of ops) {
    if (o.t === '=') p.append(document.createTextNode(o.s));
    else p.append(el(o.t === '+' ? 'ins' : 'del', '', o.s));
  }
  return p;
}

/**
 * The two runs side by side (`aId` the original or a branch, `bId` a branch of the same reply).
 * Opens in the branch sheet.
 */
export async function openDiffSheet(aId, bId, ctx, opts = {}) {
  sheet();
  show('#br-diff');
  const out = $('#br-diff');
  $('#br-title').textContent = t('Original and branch');
  out.replaceChildren(el('p', 'muted', t('Loading…')));
  let d;
  try {
    d = await ctx.api(`/runs/${aId}/diff/${bId}`);
  } catch (err) {
    out.replaceChildren(el('p', 'run-err', err.message));
    return;
  }
  const named = ctx.named ?? (() => '');
  const label = (x) => (x.label === 'original' ? t('Original') : t('Branch'));
  const parts = [];
  const sum = el('div', 'br-summary');
  sum.append(glyph('branch', 'run-icon big'), el('p', 'br-summary-line', summaryWords(d.summary)));
  parts.push(sum);
  const b = d.b.run;
  if (b.branch) parts.push(el('p', 'muted small', [t('From step {n}', { n: (b.branchedFromStep ?? 0) + 1 }), ...editWords(b.branch.edits)].join(' · ')));
  // Totals.
  const totals = el('div', 'br-grid br-totals');
  totals.append(el('span', 'br-col-h', ''), el('span', 'br-col-h', label(d.a)), el('span', 'br-col-h', label(d.b)));
  const row = (name, x, y) => totals.append(el('span', 'muted small', name), el('span', 'br-num', x), el('span', 'br-num', y));
  row(t('Steps'), nf(d.summary.stepsA), nf(d.summary.stepsB));
  row(t('Tokens'), tokens(d.summary.tokensA), tokens(d.summary.tokensB));
  row(t('Cost'), usdWords(d.summary.usdA, d.summary.costUnknown), usdWords(d.summary.usdB, d.summary.costUnknown));
  row(t('Tools'), nf(d.summary.toolsA), nf(d.summary.toolsB));
  parts.push(totals);
  // Steps.
  const steps = el('div', 'br-steps');
  steps.append(el('h4', 'run-sec-h', t('Steps')));
  for (const s of d.steps) {
    const r = el('div', `br-step${s.shared ? ' shared' : s.same ? ' same' : ' differs'}`);
    const n = el('span', 'run-step-n', String(s.idx + 1));
    if (s.shared) {
      r.append(n, el('p', 'muted small br-shared', t('The same in both (from the record, nothing ran again)')));
    } else {
      const pair = el('div', 'br-pair');
      const ca = sideCell(s.a, named);
      const cb = sideCell(s.b, named);
      ca.prepend(el('span', 'br-side small', label(d.a)));
      cb.prepend(el('span', 'br-side small', label(d.b)));
      pair.append(ca, cb);
      r.append(n, pair);
    }
    steps.append(r);
  }
  parts.push(steps);
  // Files.
  if (d.files.length) {
    const files = el('div', 'br-files');
    files.append(el('h4', 'run-sec-h', t('Files')));
    if (d.filesNote) files.append(el('p', 'muted small', t('The original run is known by file hashes only; the branch shows its own changes.')));
    for (const f of d.files) {
      const li = el('details', `br-file${f.same ? ' same' : ' differs'}`);
      const s = el('summary', 'small');
      s.append(el('code', '', f.path), el('span', 'run-chip', `${label(d.a)}: ${CHANGE[f.a.change]?.() ?? f.a.change}`), el('span', 'run-chip', `${label(d.b)}: ${CHANGE[f.b.change]?.() ?? f.b.change}`), el('span', `run-chip ${f.same ? 'ok' : 'warn'}`, f.same ? t('same') : t('different')));
      li.append(s);
      const diff = f.b.diff ?? f.a.diff;
      if (diff) {
        const pre = el('pre', 'run-out br-udiff');
        pre.dataset.raw = '';
        for (const line of diff.split('\n')) pre.append(el('span', line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : '', `${line}\n`));
        li.append(pre);
      }
      files.append(li);
    }
    parts.push(files);
  }
  // The answers.
  const ans = el('div', 'br-answers');
  ans.append(el('h4', 'run-sec-h', t('The answers')));
  if (d.answer.same) ans.append(el('p', 'muted small', t('Word for word the same.')));
  else {
    const pair = el('div', 'br-pair');
    const ca = el('div', 'br-cell');
    ca.append(el('span', 'br-side small', label(d.a)), el('p', 'br-text', d.answer.a || t('(no answer)')));
    const cb = el('div', 'br-cell');
    cb.append(el('span', 'br-side small', label(d.b)), el('p', 'br-text', d.answer.b || t('(no answer)')));
    pair.append(ca, cb);
    const wd = el('details', 'br-wordsd');
    wd.append(el('summary', 'small', t('Word by word')), answerDiff(d.answer.ops));
    ans.append(pair, wd);
  }
  parts.push(ans);
  // Notes.
  if (d.memory.onlyA.length || d.memory.onlyB.length) {
    const mem = el('div', 'br-mem small');
    mem.append(el('h4', 'run-sec-h', t('Notes she remembered')));
    if (d.memory.onlyA.length) mem.append(el('p', '', t('Only in the {side}: {ids}', { side: label(d.a), ids: d.memory.onlyA.map((x) => `#${x}`).join(', ') })));
    if (d.memory.onlyB.length) mem.append(el('p', '', t('Only in the {side}: {ids}', { side: label(d.b), ids: d.memory.onlyB.map((x) => `#${x}`).join(', ') })));
    parts.push(mem);
  }
  // What to do with the branch.
  const acts = el('div', 'row br-actions');
  const msg = el('p', 'muted small', '');
  msg.setAttribute('role', 'status');
  if (b.parentRunId) {
    const use = btn(t('Use this answer'), '', 'check');
    use.disabled = Boolean(b.branch?.usedMessageId) || !d.answer.b;
    use.onclick = async () => {
      use.disabled = true;
      try {
        await ctx.api(`/runs/${b.id}/use`, { method: 'POST', body: {} });
        msg.textContent = t('Added to the conversation, marked as a re-run.');
        ctx.onUsed?.();
      } catch (err) {
        msg.textContent = err.message;
        use.disabled = false;
      }
    };
    acts.append(use);
    const changed = (b.branch?.files ?? []).length;
    if (changed && b.branch?.copy === 'kept' && !b.branch?.applied) {
      const apply = btn(t('Apply its files to my project'), 'ghost', 'files');
      apply.onclick = async () => {
        if (!confirm(t('Copy the files this branch changed into your real project? Files you changed since are left alone.'))) return;
        apply.disabled = true;
        try {
          const r = await ctx.api(`/runs/${b.id}/apply`, { method: 'POST', body: {} });
          msg.textContent = t('Applied: {n} files. Left alone (changed since): {c}.', { n: r.written.length + r.removed.length, c: r.conflicts.length ? r.conflicts.join(', ') : t('none') });
        } catch (err) {
          msg.textContent = err.message;
          apply.disabled = false;
        }
      };
      acts.append(apply);
    }
    if (b.branch?.copy === 'kept') {
      const discard = btn(t('Discard the copy'), 'ghost');
      discard.onclick = async () => {
        discard.disabled = true;
        try {
          await ctx.api(`/runs/${b.id}/discard`, { method: 'POST', body: {} });
          msg.textContent = t('The copy is gone; the run record stays.');
        } catch (err) {
          msg.textContent = err.message;
        }
      };
      acts.append(discard);
    }
    const open = btn(t("Open the branch's run"), 'ghost', 'compass');
    open.onclick = () => {
      $('#branch-sheet').close();
      ctx.openRun?.(b.id);
    };
    acts.append(open);
  }
  if (opts.back) {
    const again = btn(t('Change something and run again'), 'ghost');
    again.onclick = () => opts.back();
    acts.append(again);
  }
  parts.push(acts, msg);
  out.replaceChildren(...parts);
}
