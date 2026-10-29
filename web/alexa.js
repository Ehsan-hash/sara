// Phase 72: Settings → Other apps → Alexa. The owner pastes the skill id and chooses the quick
// model; everyone (owner and household members) makes one-time link codes and sees and unlinks
// their own linked Alexas. Saves by itself.
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

let helpers = { copyText: async () => {} };
let codeTimer;

/** "in 9 minutes" for a code's expiry. */
export function minutesLeft(iso, now = Date.now()) {
  const m = Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
  return m === 1 ? t('for 1 more minute') : t('for {n} more minutes', { n: m });
}

function render(v) {
  if (v.owner && document.activeElement !== $('#alexa-skill')) $('#alexa-skill').value = v.skillId ?? '';
  if (v.owner) $('#alexa-quick').checked = v.quick === true;
  $('#alexa-endpoint').textContent = `${location.origin}/alexa`;
  $('#alexa-code-new').disabled = !v.configured || v.privateLocal;
  $('#alexa-status').textContent = v.privateLocal ? t('Private local mode is on: Alexa needs Amazon, so it is paused.') : v.configured ? '' : v.owner ? t('Paste the skill ID from the Alexa developer console to start.') : t('The owner of this server hasn’t set up Alexa yet.');
  $('#alexa-links').replaceChildren(
    ...(v.links.length
      ? v.links.map((l) => {
          const li = el('li');
          const name = el('strong', '', t('An Alexa linked to {name}', { name: l.companion }));
          li.append(name, el('span', 'muted small', ` · ${t('linked {date}', { date: new Date(l.linkedAt).toLocaleDateString() })}${l.lastUsedAt ? ` · ${t('last used {date}', { date: new Date(l.lastUsedAt).toLocaleDateString() })}` : ''} `));
          const rm = el('button', 'ghost small', t('Unlink'));
          rm.type = 'button';
          rm.addEventListener('click', async () => {
            if (!confirm(t('Unlink this Alexa? It stops reaching her until you link it again with a new code.'))) return;
            try {
              render(await api(`/alexa/links/${encodeURIComponent(l.id)}`, { method: 'DELETE' }));
            } catch (err) {
              $('#alexa-status').textContent = err.message;
            }
          });
          li.append(rm);
          return li;
        })
      : [el('li', 'muted small', t('No Alexa linked yet.'))]),
  );
}

export async function loadAlexa() {
  try {
    render(await api('/alexa'));
  } catch (err) {
    $('#alexa-status').textContent = err.status === 403 ? '' : err.message;
  }
}

async function save(body) {
  $('#alexa-status').textContent = '';
  try {
    render(await api('/alexa', { method: 'PUT', body }));
    $('#alexa-status').textContent = t('Saved.');
  } catch (err) {
    $('#alexa-status').textContent = err.message;
  }
}

export function initAlexa(h) {
  helpers = { ...helpers, ...h };
  $('#alexa-skill').addEventListener('change', () => save({ skillId: $('#alexa-skill').value.trim() }));
  $('#alexa-quick').addEventListener('change', () => save({ quick: $('#alexa-quick').checked }));
  $('#alexa-endpoint-copy').addEventListener('click', () => helpers.copyText($('#alexa-endpoint').textContent, $('#alexa-endpoint-copy')));
  $('#alexa-code-new').addEventListener('click', async () => {
    try {
      const r = await api('/alexa/code', { method: 'POST', body: {} });
      const show = () => {
        if (Date.parse(r.expiresAt) <= Date.now()) {
          clearInterval(codeTimer);
          $('#alexa-code').textContent = t('That code ran out. Make a new one.');
          return;
        }
        $('#alexa-code').textContent = t('Say: "Alexa, ask sara companion to link code {code}". It works once, {left}.', { code: r.code.split('').join(' '), left: minutesLeft(r.expiresAt) });
      };
      clearInterval(codeTimer);
      show();
      codeTimer = setInterval(show, 15_000);
      void loadAlexa();
    } catch (err) {
      $('#alexa-code').textContent = err.message;
    }
  });
  // The code is shown once: forget it when Settings closes.
  $('#settings').addEventListener('close', () => {
    clearInterval(codeTimer);
    $('#alexa-code').textContent = '';
  });
}
