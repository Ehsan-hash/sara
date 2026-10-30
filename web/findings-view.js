// Phase 81 (harness track M6): findings on screen. One window (`#findings`) for everything the
// security pass, live advisories, the sandbox gate and the plan check found, per project and per
// run, with pick-list filters; each finding shows the real line it quotes, what to do, and its
// actions: Fix on a branch (the fix-branch loop: progress, the re-check, the tests, the diff, then
// Apply to my branch / Keep the branch / Discard), Dismiss or Accept with a reason. Also the small
// "Security pass" card under a coding reply, the approval card's "Known vulnerability" section and
// the line under her step after the install check. Server: src/security/*.ts, /api/findings.
// Phase 82 (M7): threats show their entry point → dangerous line path; the Threat model tab
// (surfaces, trust boundaries, open threats, what changed; /api/threat-model) and the small
// "Threat model" card under a coding reply with "Fix these" (the fix-only second pass).
import { locale, serverText, t } from './naming.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const glyph = (name, cls = 'fnd-icon') => {
  const s = el('span', cls);
  s.setAttribute('aria-hidden', 'true');
  const svg = icon(name) ?? icon('warn');
  if (svg) s.append(svg);
  return s;
};
const raw = (node) => {
  node.dataset.raw = '';
  return node;
};
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(serverText(data, `HTTP ${res.status}`)), { status: res.status });
  return data;
}

const SEV = { block: () => t('blocks'), high: () => t('serious'), medium: () => t('worth a look'), low: () => t('minor'), info: () => t('note') };
const SOURCE = {
  security: () => t('Code check'),
  advisory: () => t('Known vulnerability'),
  sandbox: () => t('Sandbox try'),
  contradiction: () => t('Your decisions'),
  threat: () => t('Threat check'),
  redteam: () => t('Red team'),
};
const STAGE = { 'making the branch': () => t('making the branch'), 'asking the Coding model': () => t('asking the Coding model'), 'running the tests': () => t('running the tests') };
const STATUS = { open: () => t('open'), fixed: () => t('fixed'), dismissed: () => t('dismissed'), accepted: () => t('accepted') };
/** The code checks' titles and advice in the app language (the server's English is the fallback). */
const RULE = {
  'secret-in-code': [() => t('A secret written into the code'), () => t('Move it to an environment variable or a secrets file that git ignores, and change the key: anyone who saw this file has it.')],
  'code-exec': [() => t('Runs code or a command built from a variable'), () => t('Never pass outside input to eval, new Function or a shell. Use a fixed program with an argument list, or parse the data instead of running it.')],
  'sql-string': [() => t('SQL built by joining strings'), () => t('Use placeholders (? or $1 or %s with the values passed separately) so input can never change the query.')],
  'path-traversal': [() => t('A file path taken from the request'), () => t('Keep only the file name, resolve it inside the allowed folder and check the result is still inside it before reading or sending it.')],
  'tls-off': [() => t('Certificate checks turned off'), () => t('Leave TLS verification on. For a private certificate, add its CA to the trusted list instead.')],
  'unsafe-deserialize': [() => t('Unsafe loading of data'), () => t('pickle, marshal, plain yaml.load and unserialize can run code from the data. Use JSON or a safe loader for anything not fully trusted.')],
  'cors-credentials': [() => t('Any website may call this with the user\'s cookies'), () => t('With credentials allowed, list the exact origins that may call it; a wildcard or an echoed origin lets any site act as the signed-in user.')],
  'missing-auth': [() => t('A new route without the sign-in check the others use'), () => t('The other routes in this file use a sign-in check; add the same one here unless this route is meant to be public.')],
  'weak-crypto': [() => t('Weak cryptography for a secret'), () => t('Use a slow password hash (scrypt, bcrypt, argon2), SHA-256 or better for signatures, a secure random source for tokens and an authenticated cipher.')],
  'inner-html': [() => t('HTML built from input'), () => t('Set textContent (or create elements) instead of innerHTML for anything from the user, the address bar or the server.')],
  'debug-on': [() => t('Debug mode switched on in code'), () => t('Read debug mode from the environment and keep it off by default.')],
  // Phase 82: the threat rules (src/security/threat-graph.ts THREAT_RULES).
  'threat:shell': [() => t('Outside input reaches a shell command'), () => t('Run a fixed program with an argument list (execFile / spawn without a shell / subprocess with a list) and check the value against what is allowed first.')],
  'threat:sql': [() => t('Outside input reaches an SQL query'), () => t('Pass the value as a parameter (? / $1 / %s with the values separately) instead of putting it into the query text.')],
  'threat:path': [() => t('Outside input chooses a file path'), () => t('Keep only the file name (basename), or resolve the path inside the allowed folder and refuse it unless the result still starts with that folder.')],
  'threat:ssrf': [() => t('Outside input chooses where the server connects'), () => t('Use a fixed host, or check the URL\'s host against an allowlist before the request; never let input pick the address.')],
  'threat:deserialize': [() => t('Outside input is loaded with an unsafe loader'), () => t('Load outside data as JSON or with a safe loader (yaml.safe_load); pickle, marshal and unserialize can run code from the data.')],
  'threat:html': [() => t('Outside input is written into HTML'), () => t('Escape the value (or set textContent) before it goes into the page, or send it as JSON.')],
  'threat:redirect': [() => t('Outside input chooses where a redirect goes'), () => t('Redirect only to local paths (starting with one "/" and not "//") or to an allowlist of addresses.')],
  'threat:eval': [() => t('Outside input is run as code'), () => t('Never run outside input as code; parse the data (JSON.parse, a small parser) or map it to fixed actions.')],
  'threat:secret': [() => t('A secret is sent back to the caller'), () => t('Send only the fields the caller needs; keep environment variables, keys and passwords on the server.')],
  'threat:auth': [() => t('Anyone can reach a change without signing in'), () => t('Add the sign-in check (the middleware or decorator the project uses) to this route, or check the user inside the handler before the change.')],
  'threat:ratelimit': [() => t('A sign-in route with no rate limit'), () => t('Limit attempts per address and account (express-rate-limit, Flask-Limiter, slowapi, a counter with a lockout) so passwords can\'t be guessed quickly.')],
};
const titleOf = (f) => (RULE[f.rule]?.[0] ?? (() => f.title))();
const adviceOf = (f) => ((f.source === 'security' || f.source === 'threat') && f.origin !== 'model' && RULE[f.rule] ? RULE[f.rule][1]() : f.advice);
/** STRIDE categories of threats, in the app language. */
const CATEGORY = {
  Spoofing: () => t('Spoofing'),
  Tampering: () => t('Tampering'),
  Repudiation: () => t('Repudiation'),
  'Information disclosure': () => t('Information disclosure'),
  'Denial of service': () => t('Denial of service'),
  'Elevation of privilege': () => t('Elevation of privilege'),
};
/** Trust boundaries in the threat model summary (src/security/threats.ts threatModelOf). */
const BOUNDARY = {
  'network-in': () => t('Network → your server (HTTP routes, uploads)'),
  'messages-in': () => t('Messages from clients (WebSocket, workers)'),
  'local-in': () => t('Command line and environment'),
  outbound: () => t('Your server → other servers'),
  database: () => t('Your server → database'),
  files: () => t('Your server → files'),
  shell: () => t('Your server → commands and code'),
  deserialize: () => t('Loading serialized data'),
  'html-out': () => t('Your server → browsers (HTML, redirects)'),
};
const REASONS = [
  ['Not a real problem', () => t('Not a real problem')],
  ['Test or example code', () => t('Test or example code')],
  ['Accepted risk', () => t('Accepted risk')],
  ['Fixed another way', () => t('Fixed another way')],
];

const st = { filter: { workspace: '', status: 'open', severity: '', source: '', runId: 0, conversationId: '' }, data: null, open: new Set(), poll: null, tab: 'list' };

function sevChip(sev) {
  return el('span', `fnd-sev sev-${sev}`, (SEV[sev] ?? SEV.info)());
}

/** The diff of a fix, line by line (added / removed marked; no colours inline: CSS). */
function diffBlock(diff) {
  const pre = raw(el('pre', 'fnd-diff'));
  for (const line of String(diff ?? '').replace(/\s+$/, '').split('\n').slice(0, 400)) {
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) continue;
    const cls = line.startsWith('+') ? 'fnd-add' : line.startsWith('-') ? 'fnd-del' : line.startsWith('@@') ? 'fnd-hunk' : '';
    pre.append(el('span', cls, `${line}\n`));
  }
  return pre;
}

/** The fix-branch panel: progress, then the proof (re-check, tests), the diff and the three choices. */
function fixPanel(f, refresh) {
  const fix = f.fix;
  const box = el('div', `fnd-fix fix-${fix.state}`);
  const head = el('p', 'fnd-fix-head');
  head.append(glyph('branch'), raw(el('code', '', fix.branch)));
  const words = {
    working: () => t('Working on the fix: {stage}', { stage: (STAGE[fix.stage] ?? (() => '…'))() }),
    ready: () => t('The fix is ready on its own branch.'),
    failed: () => t('No fix: {why}', { why: fix.error ?? '' }),
    applied: () => t('Applied to your files (not committed).'),
    kept: () => t('Kept on its branch: merge it when you like.'),
    discarded: () => t('Discarded.'),
  };
  head.append(el('span', '', (words[fix.state] ?? words.working)()));
  box.append(head);
  if (fix.batch?.results) {
    const ul = el('ul', 'fnd-batch-list small');
    for (const [id, r] of Object.entries(fix.batch.results)) ul.append(el('li', r.fixed ? 'fnd-pass' : 'fnd-fail', r.fixed ? t('#{id}: the threat rule no longer finds it', { id }) : t('#{id}: still found', { id })));
    box.append(ul);
  } else if (fix.recheck) box.append(el('p', `small ${fix.recheck.fixed ? 'fnd-pass' : 'fnd-fail'}`, fix.recheck.fixed ? t('Re-check: the problem is gone ({before} → {after}).', { before: fix.recheck.before, after: fix.recheck.after }) : t('Re-check: still found ({after}).', { after: fix.recheck.after })));
  if (fix.tests) {
    const tline = !fix.tests.ran ? t('Tests not run: {why}', { why: fix.tests.note ?? '' }) : fix.tests.exitCode === 0 ? t('Tests pass ({command}) in a sandbox copy · {s} s', { command: fix.tests.command, s: (fix.tests.ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : t('Tests fail ({command}) in a sandbox copy', { command: fix.tests.command });
    box.append(el('p', `small ${fix.tests.ran && fix.tests.exitCode === 0 ? 'fnd-pass' : 'fnd-fail'}`, tline));
    if (fix.tests.ran && !fix.tests.isolated) box.append(el('p', 'small muted', t('Not isolated on this computer: the tests ran in a copy.')));
    if (fix.tests.output) {
      const d = el('details', 'fnd-out');
      d.append(el('summary', '', t('Test output')), raw(el('pre', '', fix.tests.output)));
      box.append(d);
    }
  } else if (fix.state === 'ready') box.append(el('p', 'small muted', t('No tests found in this project.')));
  if (fix.note) box.append(raw(el('p', 'small', fix.note)));
  if (fix.diff && (fix.state === 'ready' || fix.state === 'kept')) box.append(diffBlock(fix.diff));
  if (fix.applied?.conflicts?.length) box.append(el('p', 'small fnd-fail', t('Left alone (changed meanwhile): {files}', { files: fix.applied.conflicts.join(', ') })));
  const row = el('div', 'row fnd-actions');
  const act = async (how, ask) => {
    if (ask && !confirm(ask)) return;
    row.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await api(`/findings/${f.id}/fix/${how}`, { method: 'POST', body: {} });
    } catch (err) {
      box.append(el('p', 'small fnd-fail', err.message));
    }
    await refresh();
  };
  if (fix.state === 'ready') {
    const apply = el('button', '', t('Apply to my branch'));
    apply.type = 'button';
    apply.addEventListener('click', () => void act('apply'));
    const keep = el('button', 'ghost', t('Keep the branch'));
    keep.type = 'button';
    keep.addEventListener('click', () => void act('keep'));
    const drop = el('button', 'ghost', t('Discard'));
    drop.type = 'button';
    drop.addEventListener('click', () => void act('discard', t('Throw this fix and its branch away?')));
    row.append(apply, keep, drop);
    box.append(el('p', 'small muted', t('Nothing is pushed: the branch stays on this computer.')));
  } else if (fix.state === 'kept' || fix.state === 'failed') {
    const drop = el('button', 'ghost small', fix.state === 'kept' ? t('Delete the branch') : t('Clear'));
    drop.type = 'button';
    drop.addEventListener('click', () => void act('discard', fix.state === 'kept' ? t('Delete the branch {branch}?', { branch: fix.branch }) : undefined));
    row.append(drop);
  }
  if (row.childElementCount) box.append(row);
  return box;
}

/** Dismiss / accept with a reason (a pick-list, plus your own words). */
function reasonForm(f, status, refresh, onCancel) {
  const form = el('div', 'fnd-reason');
  const sel = el('select');
  sel.setAttribute('aria-label', t('Why'));
  for (const [v, w] of REASONS) sel.append(new Option(w(), v));
  sel.append(new Option(t('Other (write it)'), ''));
  const other = el('input');
  other.type = 'text';
  other.placeholder = t('Why (kept with the finding)');
  other.hidden = true;
  other.setAttribute('aria-label', t('Why (kept with the finding)'));
  sel.addEventListener('change', () => (other.hidden = sel.value !== ''));
  const ok = el('button', '', status === 'dismissed' ? t('Dismiss') : t('Accept'));
  ok.type = 'button';
  const cancel = el('button', 'ghost', t('Cancel'));
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  const msg = el('span', 'small fnd-fail');
  ok.addEventListener('click', async () => {
    const reason = sel.value || other.value.trim();
    if (!reason) return void (msg.textContent = t('Say why (a reason is kept with the finding).'));
    ok.disabled = true;
    try {
      await api(`/findings/${f.id}/status`, { method: 'POST', body: { status, reason } });
      await refresh();
    } catch (err) {
      msg.textContent = err.message;
      ok.disabled = false;
    }
  });
  form.append(sel, other, ok, cancel, msg);
  return form;
}

function findingCard(f, refresh) {
  const card = el('article', `fnd-card sev-${f.severity} status-${f.status}`);
  card.dataset.id = String(f.id);
  const head = el('div', 'fnd-head');
  head.append(glyph(f.source === 'advisory' ? 'shield' : f.source === 'sandbox' ? 'sandbox' : f.source === 'contradiction' ? 'warn' : f.source === 'threat' ? 'compass' : 'shield'), sevChip(f.severity), el('strong', 'fnd-title', titleOf(f)));
  const meta = el('p', 'fnd-meta small muted');
  meta.append(el('span', '', (SOURCE[f.source] ?? (() => f.source))()));
  if (f.origin === 'model') meta.append(el('span', '', t('found by the Reviewing model, quote checked')));
  if (f.file) meta.append(raw(el('code', '', `${f.file}${f.line ? `:${f.line}` : ''}`)));
  if (f.workspace) meta.append(raw(el('span', '', f.workspace)));
  meta.append(el('span', '', `#${f.id}`));
  if (f.status !== 'open') meta.append(el('span', `fnd-status st-${f.status}`, (STATUS[f.status] ?? STATUS.open)()));
  card.append(head, meta);
  if (f.source === 'threat' && f.meta?.entry) card.append(threatPath(f));
  else if (f.quote) card.append(raw(el('pre', 'fnd-quote', f.quote)));
  const advice = adviceOf(f);
  if (advice) card.append(el('p', 'small', advice));
  if (f.source === 'advisory' && Array.isArray(f.meta?.vulns)) {
    const ul = el('ul', 'fnd-vulns small');
    for (const v of f.meta.vulns.slice(0, 6)) {
      const li = el('li');
      const a = raw(el('a', '', v.id));
      a.href = v.url;
      a.target = '_blank';
      a.rel = 'noopener';
      li.append(a, raw(el('span', '', ` ${v.summary ?? ''}${v.fixed ? ` (${t('fixed in {v}', { v: v.fixed })})` : ''}`)));
      ul.append(li);
    }
    card.append(ul);
  }
  if (f.reason) card.append(el('p', 'small muted fnd-why', t('Why: {reason}', { reason: f.reason })));
  const member = f.fix?.batch && f.fix.batch.lead !== f.id;
  if (member && f.fix.state !== 'discarded') card.append(el('p', 'small muted fnd-batch', t('In the fix pass with #{id}: its branch and diff are there.', { id: f.fix.batch.lead })));
  else if (f.fix && f.fix.state !== 'discarded') card.append(fixPanel(f, refresh));
  // While a fix is being made or waits for your choice, its own buttons are the ones that count.
  const fixBusy = f.fix && (f.fix.state === 'working' || f.fix.state === 'ready');
  if (f.status === 'open' && !fixBusy) {
    const row = el('div', 'row fnd-actions');
    if (f.canFix) {
      const fixB = el('button', '', t('Fix on a branch'));
      fixB.type = 'button';
      fixB.addEventListener('click', async () => {
        fixB.disabled = true;
        try {
          await api(`/findings/${f.id}/fix`, { method: 'POST', body: {} });
        } catch (err) {
          card.append(el('p', 'small fnd-fail', err.message));
        }
        await refresh();
      });
      row.append(fixB);
    }
    for (const [status, label] of [['dismissed', () => t('Dismiss')], ['accepted', () => t('Accept')]]) {
      const b = el('button', 'ghost', label());
      b.type = 'button';
      b.addEventListener('click', () => {
        row.hidden = true;
        const form = reasonForm(f, status, refresh, () => {
          form.remove();
          row.hidden = false;
        });
        card.append(form);
      });
      row.append(b);
    }
    card.append(row);
  } else if (f.status === 'dismissed' || f.status === 'accepted') {
    const re = el('button', 'ghost small', t('Open again'));
    re.type = 'button';
    re.addEventListener('click', async () => {
      await api(`/findings/${f.id}/status`, { method: 'POST', body: { status: 'open' } });
      await refresh();
    });
    card.append(re);
  }
  return card;
}

function query() {
  const q = new URLSearchParams();
  const f = st.filter;
  if (f.workspace) q.set('workspace', f.workspace);
  if (f.status) q.set('status', f.status);
  if (f.severity) q.set('severity', f.severity);
  if (f.source) q.set('source', f.source);
  if (f.runId) q.set('runId', String(f.runId));
  if (f.conversationId) q.set('conversationId', f.conversationId);
  return q.toString();
}

/** Reloads the open window (filters kept). */
export async function refreshFindings() {
  const dlg = $('#findings');
  if (!dlg?.open) return;
  let data;
  try {
    data = await api(`/findings?${query()}`);
  } catch (err) {
    $('#fnd-status-line').textContent = err.message;
    return;
  }
  st.data = data;
  const ws = $('#fnd-ws');
  const cur = st.filter.workspace;
  ws.replaceChildren(new Option(t('All projects'), ''), ...data.workspaces.map((w) => new Option(w, w)));
  ws.value = data.workspaces.includes(cur) ? cur : '';
  const c = data.counts;
  const open = c.bySeverity;
  $('#fnd-status-line').textContent = t('Open: {n} ({high} serious) · fixed: {fixed} · dismissed: {dismissed} · accepted: {accepted}', { n: c.open, high: open.high + open.block, fixed: c.fixed, dismissed: c.dismissed, accepted: c.accepted });
  const chip = $('#fnd-run-chip');
  chip.hidden = !st.filter.runId && !st.filter.conversationId;
  $('#fnd-run-label').textContent = st.filter.runId ? t('Only run #{id}', { id: st.filter.runId }) : st.filter.conversationId ? t('Only this conversation') : '';
  $('#fnd-fixall').disabled = !st.filter.workspace || !(open.high + open.block);
  $('#fnd-scan').disabled = !st.filter.workspace && !st.filter.conversationId;
  if (st.tab === 'threats') return void renderThreatModel();
  const list = $('#fnd-list');
  if (!data.findings.length) {
    list.replaceChildren(el('p', 'muted fnd-empty', st.filter.status === 'open' ? t('Nothing open here. Her security pass checks the files she changes after each coding turn.') : t('No findings match these filters.')));
  } else list.replaceChildren(...data.findings.map((f) => findingCard(f, refreshFindings)));
  // A fix still working: look again in a moment (stops when the window closes or none is left).
  clearTimeout(st.poll);
  if (data.findings.some((f) => f.fix?.state === 'working')) st.poll = setTimeout(() => void refreshFindings(), 1500);
}

/** Opens the Findings window, optionally for one project, run or conversation. */
export async function openFindings(opts = {}) {
  st.filter = { workspace: opts.workspace ?? '', status: opts.status ?? 'open', severity: '', source: opts.source ?? '', runId: opts.runId ?? 0, conversationId: opts.conversationId ?? '' };
  $('#fnd-status').value = st.filter.status;
  $('#fnd-severity').value = '';
  $('#fnd-source').value = st.filter.source;
  const dlg = $('#findings');
  if (!dlg.open) dlg.showModal();
  showTab(opts.tab === 'threats' ? 'threats' : 'list');
  await refreshFindings();
}

let wired = false;
/** Wires the window's filters and buttons (once). */
export function initFindings() {
  if (wired || !$('#findings')) return;
  wired = true;
  const set = (k) => (e) => {
    st.filter[k] = e.target.value;
    void refreshFindings();
  };
  $('#fnd-ws').addEventListener('change', set('workspace'));
  $('#fnd-status').addEventListener('change', set('status'));
  $('#fnd-severity').addEventListener('change', set('severity'));
  $('#fnd-source').addEventListener('change', set('source'));
  $('#fnd-run-clear').addEventListener('click', () => {
    st.filter.runId = 0;
    st.filter.conversationId = '';
    void refreshFindings();
  });
  $('#fnd-scan').addEventListener('click', async () => {
    const b = $('#fnd-scan');
    b.disabled = true;
    $('#fnd-status-line').textContent = t('Checking…');
    try {
      const body = st.filter.conversationId ? { conversationId: st.filter.conversationId } : { workspace: st.filter.workspace };
      const r = await api('/findings/scan', { method: 'POST', body });
      st.filter.runId = 0;
      $('#fnd-status-line').textContent = t('Checked {n} files.', { n: r.summary.files });
    } catch (err) {
      $('#fnd-status-line').textContent = err.message;
    }
    b.disabled = false;
    await refreshFindings();
  });
  $('#fnd-fixall').addEventListener('click', async () => {
    if (!confirm(t('Make a fix branch for every open serious finding in {project}, one after another? Nothing is pushed; you choose for each fix.', { project: st.filter.workspace }))) return;
    try {
      const r = await api('/findings/fix-all', { method: 'POST', body: { workspace: st.filter.workspace } });
      $('#fnd-status-line').textContent = t('Fixes started: {n}', { n: r.started.length });
    } catch (err) {
      $('#fnd-status-line').textContent = err.message;
    }
    await refreshFindings();
  });
  $('#findings').addEventListener('close', () => clearTimeout(st.poll));
  $('#fnd-tab-list').addEventListener('click', () => showTab('list'));
  $('#fnd-tab-threats').addEventListener('click', () => showTab('threats'));
}

// ---- Phase 82: the threat model ----------------------------------------------------------------

/** A threat's entry point → sink path, each step with its file and line (the quotes are real lines). */
function threatPath(f) {
  const box = el('div', 'fnd-threat');
  const m = f.meta ?? {};
  const top = el('p', 'small fnd-threat-cat');
  if (m.category) top.append(el('span', 'fnd-chip', (CATEGORY[m.category] ?? (() => m.category))()));
  top.append(el('span', 'muted', t('Entry point → dangerous line')));
  box.append(top);
  const ol = el('ol', 'fnd-path small');
  for (const s of Array.isArray(m.path) ? m.path : []) {
    const li = el('li');
    li.append(raw(el('span', 'fnd-step', s.label)), raw(el('code', '', `${s.file}:${s.line}`)));
    ol.append(li);
  }
  box.append(ol);
  if (m.entry?.quote) {
    box.append(el('p', 'small muted', t('Entry point')));
    box.append(raw(el('pre', 'fnd-quote', m.entry.quote)));
  }
  box.append(el('p', 'small muted', t('Dangerous line')));
  box.append(raw(el('pre', 'fnd-quote', f.quote ?? '')));
  return box;
}

/** "Fix these": the second pass over these open threats (one branch, one diff). */
async function fixThese(ids, workspace) {
  return api('/threat-model/fix', { method: 'POST', body: { ids, ...(workspace ? { workspace } : {}) } });
}

function section(title, ...children) {
  const s = el('section', 'fnd-tm-section');
  s.append(el('h3', '', title), ...children);
  return s;
}

/** The Threat model tab: surfaces, trust boundaries, open threats, what changed (one project). */
async function renderThreatModel() {
  const box = $('#fnd-threats');
  const ws = st.filter.workspace;
  if (!ws) return void box.replaceChildren(el('p', 'muted fnd-empty', t('Pick a project to see its threat model.')));
  let r;
  try {
    r = await api(`/threat-model?workspace=${encodeURIComponent(ws)}`);
  } catch (err) {
    return void box.replaceChildren(el('p', 'small fnd-fail', err.message));
  }
  const m = r.summary;
  const head = el('div', 'fnd-tm-head');
  const line = el('p', 'small muted', m ? t('Written {when} from {n} code files. Every threat quotes real lines; nothing was run.', { when: new Date(m.at).toLocaleString(locale()), n: m.files }) : t('No threat model for this project yet. It is written after a coding turn that changes files, or now.'));
  const row = el('div', 'row fnd-actions');
  const scan = el('button', 'ghost', t('Check the whole project'));
  scan.type = 'button';
  scan.addEventListener('click', async () => {
    scan.disabled = true;
    line.textContent = t('Checking…');
    try {
      await api('/threat-model/scan', { method: 'POST', body: { workspace: ws } });
    } catch (err) {
      line.textContent = err.message;
    }
    await renderThreatModel();
  });
  row.append(scan);
  const openIds = (m?.open ?? []).map((o) => o.id);
  const turnIds = (m?.changed?.ids ?? []).filter((id) => openIds.includes(id));
  if (r.mode === 'offer' && turnIds.length) {
    const fx = el('button', '', t('Fix these'));
    fx.type = 'button';
    fx.addEventListener('click', async () => {
      if (!confirm(t('Make one local fix branch for these {n} threats? The Coding model may only fix them: no new features, no refactors. Nothing is pushed; you choose Apply, Keep or Discard.', { n: turnIds.length }))) return;
      fx.disabled = true;
      try {
        await fixThese(turnIds, ws);
        line.textContent = t('The fix pass started: see its progress in Findings.');
      } catch (err) {
        line.textContent = err.message;
      }
    });
    row.append(fx);
  }
  head.append(line, row);
  if (!m) return void box.replaceChildren(head);
  const surf = el('ul', 'fnd-tm-list small');
  for (const e of m.entries) {
    const li = el('li');
    li.append(raw(el('code', '', e.label)), raw(el('span', 'muted', ` ${e.file}:${e.line}`)));
    if (e.kind === 'http' || e.kind === 'upload') li.append(el('span', `fnd-chip ${e.authed ? 'chip-ok' : 'chip-warn'}`, e.authed ? t('signed in') : t('no sign-in check seen')));
    if (e.upload) li.append(el('span', 'fnd-chip', t('file upload')));
    if (e.kind === 'message') li.append(el('span', 'fnd-chip', t('messages')));
    if (e.kind === 'cli') li.append(el('span', 'fnd-chip', t('command line')));
    surf.append(li);
  }
  if (!m.entries.length) surf.append(el('li', 'muted', t('No entry points found.')));
  if (m.envReads) surf.append(el('li', 'muted', t('Environment variables read in {n} places (set by whoever runs the app; no threats from these).', { n: m.envReads })));
  const bounds = el('ul', 'fnd-tm-list small');
  for (const b of m.boundaries) {
    const li = el('li');
    li.append(el('span', '', (BOUNDARY[b.id] ?? (() => b.id))()), el('span', 'fnd-chip', String(b.count)));
    bounds.append(li);
  }
  const open = el('div', 'fnd-list');
  for (const o of m.open) {
    const c = el('article', `fnd-card sev-${o.severity}`);
    const h = el('div', 'fnd-head');
    h.append(glyph('shield'), sevChip(o.severity), el('strong', 'fnd-title', (RULE[o.rule]?.[0] ?? (() => o.title))()), raw(el('span', 'muted small', `#${o.id}`)));
    c.append(h);
    if (o.category) c.append(el('p', 'small muted', (CATEGORY[o.category] ?? (() => o.category))()));
    c.append(raw(el('p', 'small fnd-tm-path', o.path || `${o.entry} → ${o.sink}`)));
    if (o.origin === 'model') c.append(el('p', 'small muted', t('found by the Reviewing model, quote checked')));
    open.append(c);
  }
  if (!m.open.length) open.append(el('p', 'muted small', t('None open.')));
  const changed = el('p', 'small');
  changed.textContent = m.changed.files.length ? t('Files this turn: {files}', { files: m.changed.files.join(', ') }) : t('A check you started (the whole project).');
  const news = el('p', 'small muted', t('New threats: {n} · open from this pass: {open}', { n: m.changed.newIds.length, open: m.changed.ids.length }));
  box.replaceChildren(head, section(t('Surfaces (entry points)'), surf), section(t('Trust boundaries'), bounds), section(t('Open threats'), open), section(t('What changed this turn'), changed, news));
}

function showTab(tab) {
  st.tab = tab;
  const threats = tab === 'threats';
  $('#fnd-tab-list').classList.toggle('active', !threats);
  $('#fnd-tab-threats').classList.toggle('active', threats);
  $('#fnd-tab-list').setAttribute('aria-selected', String(!threats));
  $('#fnd-tab-threats').setAttribute('aria-selected', String(threats));
  $('#findings').classList.toggle('fnd-on-threats', threats);
  $('#fnd-threats').hidden = !threats;
  $('#fnd-list').hidden = threats;
  if (threats) void renderThreatModel();
  else void refreshFindings();
}

/** The small card under a coding reply once the threat pass is done (`meta.threats`). */
export function threatCard(summary, opts = {}) {
  const n = summary.counts ?? {};
  const serious = (n.high ?? 0) + (n.block ?? 0);
  const total = (summary.ids ?? []).length;
  const box = el('div', `fnd-chat fnd-threat-chat ${serious ? 'fnd-flagged' : total ? 'fnd-some' : 'fnd-clean'}`);
  box.append(glyph('compass'));
  const body = el('div', 'fnd-chat-body');
  body.append(el('strong', '', t('Threat model')));
  body.append(el('span', 'small', total ? t('Threats: {n} ({serious} serious), each from an entry point to a quoted line', { n: total, serious }) : t('No threats in what she changed.')));
  const notes = [t('Entry points: {n}', { n: summary.entries ?? 0 })];
  if (summary.reviewer?.ran) notes.push(t('Reviewing model: {n} added', { n: summary.reviewer.added ?? 0 }));
  if (summary.error) notes.push(t('The pass stopped: {why}', { why: summary.error }));
  body.append(el('span', 'small muted', notes.join(' · ')));
  const msg = el('span', 'small muted');
  body.append(msg);
  box.append(body);
  const row = el('div', 'fnd-chat-actions');
  if (opts.onOpen) {
    const b = el('button', 'ghost small', t('Show threat model'));
    b.type = 'button';
    b.addEventListener('click', () => opts.onOpen(summary));
    row.append(b);
  }
  if (total && summary.mode === 'offer') {
    const fx = el('button', 'small', t('Fix these'));
    fx.type = 'button';
    fx.addEventListener('click', async () => {
      fx.disabled = true;
      try {
        await fixThese(summary.ids, summary.workspace);
        msg.textContent = t('The fix pass started: see its progress in Findings.');
        opts.onFixStarted?.(summary);
      } catch (err) {
        msg.textContent = err.message;
        fx.disabled = false;
      }
    });
    row.append(fx);
  }
  if (row.childElementCount) box.append(row);
  return box;
}


// ---- in the chat ---------------------------------------------------------------------------------

/** The small card under a coding reply once her security pass is done (`meta.security`). */
export function securityCard(summary, opts = {}) {
  const n = summary.counts ?? {};
  const serious = (n.high ?? 0) + (n.block ?? 0);
  const total = (summary.ids ?? []).length;
  const box = el('div', `fnd-chat ${serious ? 'fnd-flagged' : total ? 'fnd-some' : 'fnd-clean'}`);
  box.append(glyph('shield'));
  const body = el('div', 'fnd-chat-body');
  body.append(el('strong', '', t('Security pass')));
  body.append(el('span', 'small', total ? t('Findings: {n} ({serious} serious)', { n: total, serious }) : t('Nothing found in the files she changed.')));
  const notes = [];
  if (summary.reviewer?.ran) notes.push(t('Reviewing model: {n} added', { n: summary.reviewer.added ?? 0 }));
  const adv = summary.advisories ?? {};
  if (adv.note === 'offline') notes.push(t('Dependencies not checked: offline'));
  else if (adv.note === 'private') notes.push(t('Dependencies not checked: private conversation'));
  else if (adv.checked) notes.push(t('Dependencies checked: {n}', { n: adv.checked }));
  if (summary.error) notes.push(t('The pass stopped: {why}', { why: summary.error }));
  if (notes.length) body.append(el('span', 'small muted', notes.join(' · ')));
  box.append(body);
  if (total && opts.onOpen) {
    const b = el('button', 'ghost small', t('Show findings'));
    b.type = 'button';
    b.addEventListener('click', () => opts.onOpen(summary));
    box.append(b);
  }
  return box;
}

/** The approval card's "Known vulnerability" section (the buttons are the caller's). */
export function advisorySection(card) {
  const box = el('div', 'fnd-adv');
  const head = el('p', 'fnd-adv-head');
  head.append(glyph('shield'), el('strong', '', t('Known vulnerability')));
  box.append(head);
  for (const p of card.packages ?? []) {
    const row = el('div', 'fnd-adv-pkg');
    const top = el('p', '');
    top.append(sevChip(p.severity), raw(el('code', '', `${p.name} ${p.version}`)), el('span', 'small muted', ` ${p.ecosystem}`));
    row.append(top);
    const ul = el('ul', 'fnd-vulns small');
    for (const v of (p.vulns ?? []).slice(0, 4)) {
      const li = el('li');
      const a = raw(el('a', '', v.id));
      a.href = v.url;
      a.target = '_blank';
      a.rel = 'noopener';
      li.append(a, raw(el('span', '', ` ${v.summary ?? ''}`)));
      if (v.fixed) li.append(el('span', 'muted', ` (${t('fixed in {v}', { v: v.fixed })})`));
      ul.append(li);
    }
    row.append(ul);
    box.append(row);
  }
  box.append(el('p', 'small muted', t('From OSV.dev. Installing anyway is your explicit choice and is recorded with the finding.')));
  return box;
}

/** The line under her step after the install check (installed anyway, not installed, not checked). */
export function advisoryFlag(ev) {
  const words = {
    override: () => t('Installed anyway (your override): {packages}', { packages: ev.packages.join(', ') }),
    declined: () => t('Not installed (known vulnerability): {packages}', { packages: ev.packages.join(', ') }),
    offline: () => t('Not checked: offline ({packages})', { packages: ev.packages.join(', ') }),
  };
  const box = el('div', `fnd-flag fnd-flag-${ev.state}`);
  box.dataset.call = ev.id ?? '';
  box.append(glyph('shield'), raw(el('span', 'small', (words[ev.state] ?? words.offline)())));
  return box;
}
