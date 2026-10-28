// Phase 44: her library. A window listing the documents she keeps (add, search, open one to see
// what she learned and the text she read, remove), plus the upload used by the 📎 in chat.
import { serverText, t } from './naming.js';

const $ = (sel) => document.querySelector(sel);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
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

/** File types she reads (the server checks the file itself too). */
export const DOC_EXTS = ['pdf', 'docx', 'xlsx', 'pptx', 'epub', 'html', 'htm', 'md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'log', 'rtf'];
export const isDocFile = (f) => !f.type.startsWith('image/') && (DOC_EXTS.includes((f.name.split('.').pop() ?? '').toLowerCase()) || /pdf|word|sheet|presentation|epub|text\/|csv|html/.test(f.type));

const KIND_ICON = { pdf: '📕', docx: '📘', xlsx: '📗', pptx: '📙', epub: '📖', html: '🌐', markdown: '📝', text: '📄', csv: '📊', image: '🖼️' };
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Uploads one document. keep = in her library; otherwise only for `conversationId` (read once).
 * Returns the stored document (or the copy already in her library).
 */
export async function uploadDoc(file, { keep = true, conversationId = null, learn = true } = {}) {
  const q = new URLSearchParams({ name: file.name, keep: keep ? '1' : '0', learn: learn ? '1' : '0' });
  if (conversationId) q.set('conversation', conversationId);
  const res = await fetch(`/api/library?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(serverText(data, `HTTP ${res.status}`));
  return data.doc;
}

/** Waits until documents are read (or a limit), calling back with progress text. */
export async function waitRead(ids, onState = () => {}, ms = 90_000) {
  const until = Date.now() + ms;
  let docs = [];
  while (Date.now() < until) {
    docs = (await Promise.all(ids.map((id) => api(`/library/${id}`).then((r) => r.doc).catch(() => null)))).filter(Boolean);
    const busy = docs.filter((d) => d.status === 'waiting' || d.status === 'reading');
    if (!busy.length) return docs;
    onState(`${t('Reading')} ${busy.map((d) => d.name).join(', ')}…`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  return docs;
}

function statusText(d) {
  if (d.status === 'waiting' || d.status === 'reading') return t('Reading it…');
  if (d.status === 'failed') return `${t("Couldn't read it")}: ${d.error ?? ''}`;
  const bits = [];
  if (d.passages) bits.push(`${d.passages} ${d.passages === 1 ? t('passage') : t('passages')}`);
  if (d.pagesSeen) bits.push(`${d.pagesSeen} ${t('scanned pages read')}`);
  if (d.learn === 'waiting' || d.learn === 'learning') bits.push(t('learning the key points…'));
  else if (d.learn === 'done') bits.push(d.facts ? `${d.facts} ${d.facts === 1 ? t('note in her memory') : t('notes in her memory')}` : t('nothing to remember'));
  else if (d.learn === 'failed') bits.push(t("couldn't learn from it yet"));
  return bits.join(' · ');
}

let current = null;
let textFrom = 0;

async function loadList() {
  let r;
  try {
    r = await api('/library');
  } catch (err) {
    $('#lib-summary').textContent = err.status === 403 ? t('The library is not available in the demo.') : err.message;
    $('#lib-list').replaceChildren();
    return;
  }
  const c = r.counts;
  const meaning = r.meaning ? (r.meaning.error ? ` ${t('Meaning search: not answering')} (${r.meaning.error.slice(0, 80)}).` : r.meaning.total ? ` ${t('Meaning search on')} (${Math.min(r.meaning.indexed, r.meaning.total)} ${t('of')} ${r.meaning.total} ${t('passages ready')}).` : ` ${t('Meaning search on.')}`) : ` ${t('Finds things by their words (turn on Meaning search in Settings → Which model does what to also find them by meaning).')}`;
  $('#lib-summary').textContent = c.docs ? `${c.docs} ${c.docs === 1 ? t('document') : t('documents')}, ${sizeText(c.bytes)}.${meaning}` : t('Nothing here yet. Add a document to get started.');
  $('#lib-shared-row').hidden = !(window.saraCompanionCount?.() > 1);
  $('#lib-shared').checked = Boolean(r.shared);
  $('#lib-list').replaceChildren(
    ...r.docs.map((d) => {
      const card = el('button', 'lib-card');
      card.type = 'button';
      card.append(el('span', 'lib-icon', KIND_ICON[d.kind] ?? '📄'));
      const body = el('span', 'lib-card-body');
      body.append(el('span', 'lib-name', d.title && d.title.length < 80 ? d.title : d.name));
      if (d.summary) body.append(el('span', 'lib-about muted small', d.summary));
      body.append(el('span', `lib-state small${d.status === 'failed' ? ' error' : ' muted'}`, `${statusText(d)} · ${sizeText(d.size)} · ${new Date(d.addedAt).toLocaleDateString()}`));
      card.append(body);
      card.addEventListener('click', () => void openDoc(d.id));
      return card;
    }),
  );
  // Still reading or learning: look again shortly.
  if (r.docs.some((d) => ['waiting', 'reading'].includes(d.status) || ['waiting', 'learning'].includes(d.learn))) scheduleRefresh();
}

let refreshTimer = 0;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (!$('#library').open) return;
    if (current) void openDoc(current, { quiet: true });
    else void loadList();
  }, 2500);
}

async function openDoc(id, { quiet = false } = {}) {
  let r;
  try {
    r = await api(`/library/${id}`);
  } catch (err) {
    $('#lib-upload-status').textContent = err.message;
    return showHome();
  }
  const d = r.doc;
  current = id;
  $('#lib-home').hidden = true;
  $('#lib-doc').hidden = false;
  $('#lib-doc-name').textContent = `${KIND_ICON[d.kind] ?? '📄'} ${d.name}`;
  $('#lib-doc-about').textContent = [d.title && d.title !== d.name ? d.title : '', d.summary ?? ''].filter(Boolean).join(' · ');
  $('#lib-doc-state').textContent = `${statusText(d)}${d.keep ? '' : ` · ${t('shared in one chat only')}`}`;
  $('#lib-doc-state').classList.toggle('error', d.status === 'failed');
  $('#lib-doc-warnings').replaceChildren(...(d.warnings ?? []).map((w) => el('li', '', w)));
  $('#lib-doc-download').href = `/api/library/${d.id}/file`;
  $('#lib-doc-download').setAttribute('download', d.name);
  $('#lib-doc-keep').hidden = d.keep;
  $('#lib-doc-relearn').hidden = !d.keep || d.status !== 'ready';
  $('#lib-doc-facts').replaceChildren(
    ...(r.facts.length
      ? r.facts.map((f) => {
          const row = el('div', 'mem');
          row.append(el('div', '', f.content));
          if (f.evidence) row.append(el('div', 'muted small', `“${f.evidence}”`));
          const del = el('button', 'ghost small', t('Delete'));
          del.type = 'button';
          del.addEventListener('click', async () => {
            await api(`/memories/${f.id}`, { method: 'DELETE' });
            row.remove();
          });
          const bar = el('div', 'mem-actions');
          bar.append(del);
          row.append(bar);
          return row;
        })
      : [el('p', 'muted small', d.learn === 'waiting' || d.learn === 'learning' ? t('She is still reading it for the key points…') : d.keep ? t('No notes from this one.') : t('Documents shared in one chat only aren\'t learned. Keep it in her library to learn from it.'))]),
  );
  if (!quiet) {
    textFrom = 0;
    $('#lib-doc-text').replaceChildren();
    showText(r.passages);
  }
  if (['waiting', 'reading'].includes(d.status) || ['waiting', 'learning'].includes(d.learn)) scheduleRefresh();
}

function showText(passages) {
  let last = $('#lib-doc-text').lastElementChild?.dataset.place ?? null;
  for (const p of passages) {
    if (p.place && p.place !== last) {
      const h = el('div', 'lib-place muted small', p.place);
      h.dataset.place = p.place;
      $('#lib-doc-text').append(h);
      last = p.place;
    }
    const para = el('p', 'lib-passage', p.text);
    para.dataset.place = p.place;
    $('#lib-doc-text').append(para);
  }
  textFrom += passages.length;
  $('#lib-doc-more').hidden = passages.length < 40;
}

function showHome() {
  current = null;
  $('#lib-doc').hidden = true;
  $('#lib-home').hidden = false;
  void loadList();
}

async function addFiles(files) {
  const docs = [...files];
  if (!docs.length) return;
  const status = $('#lib-upload-status');
  status.classList.remove('error');
  for (const f of docs) {
    status.textContent = `${t('Adding')} ${f.name}…`;
    try {
      const d = await uploadDoc(f, { keep: true, learn: $('#lib-learn').checked });
      status.textContent = d ? `${t('Added')} ${d.name}. ${t('She is reading it now.')}` : '';
      // L7: the line goes once she has read it (the list shows the result).
      if (d?.id)
        void waitRead([d.id], () => {}, 5 * 60_000).then(() => {
          if (status.textContent.startsWith(`${t('Added')} ${d.name}.`)) status.textContent = '';
          void loadList();
        });
    } catch (err) {
      status.textContent = `${f.name}: ${err.message}`;
      status.classList.add('error');
    }
    await loadList();
  }
}

export async function openLibrary(docId) {
  $('#lib-upload-status').textContent = '';
  $('#lib-q').value = '';
  $('#lib-hits').hidden = true;
  if (!$('#library').open) $('#library').showModal();
  if (docId) await openDoc(docId);
  else showHome();
}

$('#open-library').addEventListener('click', () => void openLibrary());
$('#lib-back').addEventListener('click', showHome);
$('#lib-file').addEventListener('change', async () => {
  await addFiles($('#lib-file').files);
  $('#lib-file').value = '';
});
for (const ev of ['dragover', 'drop']) {
  $('#lib-drop').addEventListener(ev, (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    if (ev === 'drop') void addFiles(e.dataTransfer.files);
  });
}
$('#lib-doc-more').addEventListener('click', async () => {
  const r = await api(`/library/${current}/passages?from=${textFrom}&limit=40`);
  showText(r.passages);
});
$('#lib-doc-keep').addEventListener('click', async () => {
  await api(`/library/${current}`, { method: 'PATCH', body: { keep: true } });
  await openDoc(current);
});
$('#lib-doc-reread').addEventListener('click', async () => {
  await api(`/library/${current}/reread`, { method: 'POST', body: {} });
  await openDoc(current);
});
$('#lib-doc-relearn').addEventListener('click', async () => {
  await api(`/library/${current}/learn`, { method: 'POST', body: {} });
  await openDoc(current);
});
$('#lib-doc-delete').addEventListener('click', () => {
  // Ask once, with plain choices, right under the button.
  if ($('#lib-remove-bar')) return;
  const bar = el('div', 'unsaved-bar lib-remove-bar');
  bar.id = 'lib-remove-bar';
  bar.append(el('span', '', t('Remove this document?')));
  const choice = (label, cls, forget) => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      bar.remove();
      if (forget === null) return;
      await api(`/library/${current}${forget ? '?forget=1' : ''}`, { method: 'DELETE' });
      showHome();
    });
    bar.append(b);
  };
  choice(t('Remove and forget what she learned'), 'danger', true);
  choice(t('Remove, keep what she learned'), 'ghost', false);
  choice(t('Cancel'), 'ghost', null);
  $('#lib-doc-delete').closest('.actions-left').after(bar);
});
$('#lib-shared').addEventListener('change', async () => {
  const r = await api('/library/settings', { method: 'PUT', body: { shared: $('#lib-shared').checked } });
  $('#lib-upload-status').textContent = r.restart ? t('Saved. It takes effect after Sara restarts (Settings → Updates → Restart).') : t('Saved.');
});
let searchTimer = 0;
$('#lib-q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $('#lib-q').value.trim();
    const box = $('#lib-hits');
    if (!q) return void (box.hidden = true);
    const r = await api(`/library/search?q=${encodeURIComponent(q)}`).catch(() => ({ hits: [] }));
    box.hidden = false;
    box.replaceChildren(
      ...(r.hits.length
        ? r.hits.map((h) => {
            const b = el('button', 'lib-hit');
            b.type = 'button';
            b.append(el('span', 'lib-hit-src small', `${h.name}${h.place ? `, ${h.place}` : ''}`), el('span', 'lib-hit-text', h.text.length > 320 ? `${h.text.slice(0, 320)}…` : h.text));
            b.addEventListener('click', () => void openDoc(h.docId));
            return b;
          })
        : [el('p', 'muted small', t('Nothing found.'))]),
    );
  }, 300);
});
// Live updates while the window is open (another device added one, reading finished).
window.addEventListener('sara:library', () => {
  if ($('#library').open) scheduleRefresh();
});
