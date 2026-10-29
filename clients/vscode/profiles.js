// Sara for VS Code, Phase 68: several Sara servers, each with its own sign-in. Pure logic (no
// `vscode` import) so it can be tested in Node. The whole list, tokens included, is kept in VS Code's
// secret storage under one key; nothing of it goes into settings.
'use strict';

const PROFILES_KEY = 'sara.servers';

/** @param {string} raw */
function normalizeServer(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `${/^(localhost|127\.)/.test(s) ? 'http' : 'https'}://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/** host[:port], for showing and for matching. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || '');
  }
}

function nextId(list) {
  const used = new Set(list.map((p) => p.id));
  for (let i = 1; ; i++) if (!used.has(`s${i}`)) return `s${i}`;
}

/**
 * The saved list in its current shape. `legacy` is the sign-in saved before 1.8 (one server:
 * { token, server }); it becomes profile #1 with nothing for the user to do.
 * @returns {{ version: 2, active?: string, servers: { id: string, name: string, named?: boolean, url: string, token?: string, deviceId?: string, lastUsed?: string, emoji?: string }[] }}
 */
function migrate(raw, legacy) {
  let j;
  try {
    j = typeof raw === 'string' && raw ? JSON.parse(raw) : raw || undefined;
  } catch {
    j = undefined;
  }
  const servers = j && Array.isArray(j.servers) ? j.servers.filter((p) => p && typeof p.id === 'string' && typeof p.url === 'string').map((p) => ({ ...p, name: String(p.name || hostOf(p.url)) })) : [];
  let active = j && typeof j.active === 'string' ? j.active : undefined;
  if (!servers.length && legacy && legacy.token && legacy.server) {
    let url = legacy.server;
    try {
      url = normalizeServer(legacy.server);
    } catch {
      /* as saved */
    }
    servers.push({ id: 's1', name: hostOf(url), url, token: legacy.token });
    active = 's1';
  }
  if (!servers.some((p) => p.id === active)) active = servers.length ? servers[0].id : undefined;
  return { version: 2, ...(active ? { active } : {}), servers };
}

function active(state) {
  return state.servers.find((p) => p.id === state.active);
}

/** A name nobody else in the list uses: "Sara", then "Sara (127.0.0.1:7882)". */
function uniqueName(state, wanted, url, self) {
  const others = state.servers.filter((p) => p.id !== self).map((p) => p.name.toLowerCase());
  const base = String(wanted || '').trim().slice(0, 60) || hostOf(url);
  if (!others.includes(base.toLowerCase())) return base;
  const withHost = `${base} (${hostOf(url)})`;
  if (!others.includes(withHost.toLowerCase())) return withHost;
  for (let i = 2; ; i++) if (!others.includes(`${withHost} ${i}`.toLowerCase())) return `${withHost} ${i}`;
}

/** Adds (or signs in again, same address) a server and makes it the one in use. */
function upsert(state, add, now = new Date()) {
  const url = normalizeServer(add.url);
  const old = state.servers.find((p) => p.url === url);
  const id = old ? old.id : nextId(state.servers);
  const named = Boolean((old && old.named) || add.name);
  const name = old && old.named && !add.name ? old.name : uniqueName(state, add.name || (old && old.name) || hostOf(url), url, id);
  const p = { id, name, ...(named ? { named: true } : {}), url, token: add.token, ...(add.deviceId ? { deviceId: add.deviceId } : {}), lastUsed: now.toISOString(), ...(old && old.emoji ? { emoji: old.emoji } : {}) };
  return { version: 2, active: id, servers: old ? state.servers.map((x) => (x.id === id ? p : x)) : [...state.servers, p] };
}

/** Switches to `id` (no sign-out anywhere). */
function use(state, id, now = new Date()) {
  if (!state.servers.some((p) => p.id === id)) return state;
  return { ...state, active: id, servers: state.servers.map((p) => (p.id === id ? { ...p, lastUsed: now.toISOString() } : p)) };
}

/** Renames one (user-chosen names stick); `herName` updates it only while it isn't user-named. */
function rename(state, id, name, opts = {}) {
  return {
    ...state,
    servers: state.servers.map((p) => {
      if (p.id !== id) return p;
      if (opts.herName && p.named) return p;
      return { ...p, name: uniqueName(state, name, p.url, id), ...(opts.herName ? {} : { named: true }) };
    }),
  };
}

/** Forgets one server and only its token; the most recently used other one becomes active. */
function remove(state, id) {
  const servers = state.servers.filter((p) => p.id !== id);
  const next = state.active === id ? [...servers].sort((a, b) => String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')))[0] : active({ servers, active: state.active });
  return { version: 2, ...(next ? { active: next.id } : {}), servers };
}

/**
 * The token for a request to `url` from profile `p`: only when `url` is exactly that profile's own
 * address, so a token can never be sent to another server.
 */
function tokenFor(p, url) {
  if (!p || !p.token || !url) return undefined;
  try {
    return normalizeServer(p.url) === normalizeServer(url) ? p.token : undefined;
  } catch {
    return undefined;
  }
}

/** What the status bar says: who's in use and that she can use this editor's files. */
function statusText(state) {
  const p = active(state);
  if (!p) return { text: '$(account) Sara: sign in', tooltip: 'Sara: not signed in to any server. Click to add one.' };
  const many = state.servers.length > 1;
  return {
    text: `$(account) ${p.emoji ? `${p.emoji} ` : ''}${p.name}${many ? ' $(chevron-down)' : ''}`,
    tooltip: `Sara on ${p.name} (${hostOf(p.url)}) can use this computer: the files and selections you send her from VS Code go to this server only.${many ? ` ${state.servers.length} servers saved; click to switch.` : ' Click to add another server.'}`,
  };
}

module.exports = { PROFILES_KEY, normalizeServer, hostOf, migrate, active, uniqueName, upsert, use, rename, remove, tokenFor, statusText };
