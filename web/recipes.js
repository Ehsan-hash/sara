// Phase 50: Settings → Abilities → Recipes: the recipes she saved (how she did tricky jobs). Open one
// to read it; the title, when to use it, workspace and steps save when you leave each box; delete.
import { t } from './naming.js';

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
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

let open = null;

export async function loadRecipes() {
  const box = $('#rc-list');
  let r;
  try {
    r = await api('/recipes');
  } catch (err) {
    return box.replaceChildren(el('p', 'muted small', err.message));
  }
  if (!r.recipes.length) {
    box.replaceChildren(el('p', 'muted small', t('No recipes yet. After a tricky coding job goes well, she offers to save how she did it.')));
    closeEditor();
    return;
  }
  box.replaceChildren(
    ...r.recipes.map((rc) => {
      const b = el('button', `rc-item${open?.id === rc.id ? ' active' : ''}`);
      b.type = 'button';
      b.append(el('strong', '', rc.title));
      if (rc.whenToUse) b.append(el('span', 'muted small', rc.whenToUse));
      b.append(el('small', 'muted', `${rc.workspace ? `${t('workspace')} ${rc.workspace}` : t('any workspace')} · ${t('used')} ${rc.uses}× · ${new Date(rc.updatedAt).toLocaleDateString()}`));
      b.addEventListener('click', () => openRecipe(rc));
      return b;
    }),
  );
  if (open) {
    const still = r.recipes.find((x) => x.id === open.id);
    if (still) openRecipe(still);
    else closeEditor();
  }
}

function openRecipe(rc) {
  const same = open?.id === rc.id;
  open = rc;
  $('#rc-edit').hidden = false;
  const fill = (id, v) => {
    if (!same || document.activeElement !== $(id)) $(id).value = v;
  };
  fill('#rc-title', rc.title);
  fill('#rc-when', rc.whenToUse);
  fill('#rc-ws', rc.workspace ?? '');
  fill('#rc-steps', rc.steps);
  $('#rc-meta').textContent = `${t('Saved')} ${new Date(rc.createdAt).toLocaleString()} · ${t('used')} ${rc.uses}×${rc.lastUsedAt ? ` (${t('last')} ${new Date(rc.lastUsedAt).toLocaleDateString()})` : ''}`;
  if (!same) $('#rc-status').textContent = '';
  for (const b of document.querySelectorAll('#rc-list .rc-item')) b.classList.toggle('active', b.querySelector('strong')?.textContent === rc.title);
}

function closeEditor() {
  open = null;
  $('#rc-edit').hidden = true;
}

async function save(field, value) {
  if (!open) return;
  try {
    open = await api(`/recipes/${open.id}`, { method: 'PATCH', body: { [field]: value } });
    $('#rc-status').textContent = t('Saved.');
    void loadRecipes();
  } catch (err) {
    $('#rc-status').textContent = err.message;
  }
}

export function initRecipes() {
  for (const [id, field] of [['#rc-title', 'title'], ['#rc-when', 'whenToUse'], ['#rc-ws', 'workspace'], ['#rc-steps', 'steps']]) {
    $(id).addEventListener('change', () => void save(field, $(id).value));
  }
  $('#rc-close').addEventListener('click', closeEditor);
  $('#rc-delete').addEventListener('click', async () => {
    if (!open || !confirm(t(`Delete the recipe "${open.title}"? She won't find it again.`))) return;
    try {
      await api(`/recipes/${open.id}`, { method: 'DELETE' });
      closeEditor();
      void loadRecipes();
    } catch (err) {
      $('#rc-status').textContent = err.message;
    }
  });
}
