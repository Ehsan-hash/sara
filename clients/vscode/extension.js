// Sara for VS Code (Phase 52). Plain JavaScript, no packages, no build step.
// The panel is the same Sara as the web app: it talks to your own server with a device token
// (Sara: Sign in shows a short code that you approve in Settings → Devices and sign-in). The
// open file's name and the selection go along as context, size-capped, and the panel shows
// exactly what was sent. The token is kept in VS Code's secret storage, never in settings.
'use strict';
const vscode = require('vscode');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TOKEN_KEY = 'sara.deviceToken';
const VERSION = '0.52.0';
/** Files that are never sent (env files, keys, credentials). */
const SECRET_FILE = /(^\.env($|\.)|^\.npmrc$|^\.netrc$|^id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx|jks|keystore|kdbx|asc|gpg)$|^credentials(\.\w+)?$|secret|password|\.tfstate$)/i;

/** @param {string} raw */
function normalizeServer(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `${/^(localhost|127\.)/.test(s) ? 'http' : 'https'}://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * The saved sign-in: the device token together with the exact server it was issued by. A plain old
 * token (saved before 0.55) is bound to the user-level setting, never to a workspace's.
 * @returns {{ token: string, server: string } | undefined}
 */
function parseSaved(raw, legacyServer) {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.token === 'string' && typeof j.server === 'string') return { token: j.token, server: normalizeServer(j.server) };
  } catch {
    /* an old plain token */
  }
  if (typeof raw === 'string' && raw.startsWith('sara_dev.') && legacyServer) return { token: raw, server: normalizeServer(legacyServer) };
  return undefined;
}

/**
 * The token to send to `server`, or undefined when it was saved for another server: a token never
 * goes to an address it wasn't issued by (a cloned repo's settings could point elsewhere).
 */
function tokenForServer(saved, server) {
  if (!saved || !server) return undefined;
  let a;
  let b;
  try {
    a = normalizeServer(saved.server);
    b = normalizeServer(server);
  } catch {
    return undefined;
  }
  return a && a === b ? saved.token : undefined;
}

/** Reads server-sent events: yields each `data:` JSON object. */
async function* sseEvents(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (!data) continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* skip */
      }
    }
  }
}

/**
 * What goes with a question from the editor: the file name (relative to the workspace), its
 * language, the lines, and the code itself, cut at `max` characters.
 */
function editorContext(editor, opts) {
  const doc = editor.document;
  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  const name = path.basename(doc.fileName);
  if (SECRET_FILE.test(name)) return { refused: `${name} looks like a secret (keys, .env, passwords), so it isn't sent.` };
  const sel = editor.selection;
  const whole = opts.whole || sel.isEmpty;
  const range = whole ? new vscode.Range(0, 0, doc.lineCount, 0) : new vscode.Range(sel.start.line, 0, sel.end.line, doc.lineAt(Math.min(sel.end.line, doc.lineCount - 1)).text.length);
  let code = doc.getText(range);
  const max = opts.max;
  const cut = code.length > max;
  if (cut) code = code.slice(0, max);
  const first = range.start.line + 1;
  const last = Math.min(doc.lineCount, range.end.line + (whole ? 0 : 1));
  const lines = whole ? `the whole file (${doc.lineCount} lines)` : `lines ${first}-${last} of ${doc.lineCount}`;
  const fence = code.includes('```') ? '~~~~' : '```';
  const text = `[From VS Code: the owner shared this from the open editor.]\nFile: ${rel} (${doc.languageId}), ${lines}${cut ? `, cut at ${max} characters` : ''}\n${fence}${doc.languageId}\n${code}\n${fence}`;
  return { text, summary: `${rel} · ${lines} · ${code.length.toLocaleString()} characters${cut ? ' (cut)' : ''}` };
}

class SaraClient {
  constructor(context) {
    this.context = context;
  }
  get server() {
    // Only the user-level value: a workspace's .vscode/settings.json can't redirect her (the setting
    // is also application-scoped in package.json).
    const c = vscode.workspace.getConfiguration('sara').inspect('server');
    return normalizeServer((c && (c.globalValue || c.defaultValue)) || '');
  }
  async saved() {
    const c = vscode.workspace.getConfiguration('sara').inspect('server');
    return parseSaved(await this.context.secrets.get(TOKEN_KEY), c && c.globalValue);
  }
  async token() {
    return tokenForServer(await this.saved(), this.server);
  }
  async request(p, init = {}) {
    const server = this.server;
    if (!server) throw new Error('Set your Sara server first: run "Sara: Sign in".');
    let token;
    if (!init.noAuth) {
      const saved = await this.saved();
      token = tokenForServer(saved, server);
      if (saved && !token) {
        const err = new Error(`This editor was signed in to ${saved.server}, not ${server}. Run "Sara: Sign in" again to use this server.`);
        err.status = 401;
        throw err;
      }
    }
    const headers = { 'user-agent': `SaraVSCode/${VERSION} (${os.platform()})` };
    if (token) headers.authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.bytes) headers['content-type'] = 'application/octet-stream';
    let res;
    try {
      res = await fetch(`${server}/api${p}`, { method: init.method || (init.body !== undefined || init.bytes ? 'POST' : 'GET'), headers, body: init.bytes || (init.body !== undefined ? JSON.stringify(init.body) : undefined), signal: init.signal, redirect: 'error' });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error(`Couldn't reach ${server}. Is the address right and the server running?`);
    }
    return res;
  }
  async json(p, init = {}) {
    const res = await this.request(p, init);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'Not signed in (or this editor was signed out). Run "Sara: Sign in".' : data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
}

class SaraPanel {
  constructor(context, client) {
    this.context = context;
    this.client = client;
    this.view = undefined;
    this.busy = undefined;
    this.queue = [];
    this.companion = 'Sara';
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(16).toString('base64');
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js'));
    const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'));
    // Strict: only this extension's own script (with its nonce) and stylesheet; no network at all
    // from the page (the extension talks to the server, the page only shows what it's given).
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${view.webview.cspSource}; connect-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}"><title>Sara</title></head>
<body><div id="status" class="status" role="status"></div><div id="log" class="log" aria-live="polite"></div>
<form id="composer" class="composer"><textarea id="input" rows="3" placeholder="Message Sara (Enter sends, Shift+Enter for a new line)"></textarea>
<div class="row"><button id="send" type="submit">Send</button><button id="stop" type="button" class="ghost" hidden>Stop</button><button id="new" type="button" class="ghost">New conversation</button><button id="signin" type="button" class="ghost" hidden>Sign in</button></div></form>
<script nonce="${nonce}" src="${js}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    void this.refresh();
  }

  post(msg) {
    if (this.view) void this.view.webview.postMessage(msg);
    else this.queue.push(msg);
  }

  async refresh() {
    const token = await this.client.token();
    if (!token || !this.client.server) return this.post({ type: 'state', signedIn: false, server: this.client.server });
    try {
      const me = await this.client.json('/device/whoami');
      this.companion = me.companion || 'Sara';
      this.post({ type: 'state', signedIn: true, server: this.client.server, companion: this.companion, device: me.device && me.device.label });
    } catch (err) {
      this.post({ type: 'state', signedIn: false, server: this.client.server, error: err.message });
    }
  }

  async onMessage(m) {
    if (m.type === 'send') return this.ask(String(m.text || ''));
    if (m.type === 'stop') return this.stop();
    if (m.type === 'new') {
      await this.context.workspaceState.update('sara.conversationId', undefined);
      return this.post({ type: 'notice', text: 'The next message starts a new conversation.' });
    }
    if (m.type === 'signIn') return vscode.commands.executeCommand('sara.signIn');
    if (m.type === 'approve') {
      try {
        await this.client.json(`/approvals/${encodeURIComponent(m.approvalId)}`, { body: { approved: Boolean(m.approved) } });
      } catch (err) {
        this.post({ type: 'error', message: err.message });
      }
    }
  }

  async conversation() {
    const saved = this.context.workspaceState.get('sara.conversationId');
    if (saved) {
      try {
        await this.client.json(`/conversations/${encodeURIComponent(saved)}?limit=20`);
        return saved;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
    // A coding conversation in her default workspace (same memory and personality as everywhere).
    const c = await this.client.json('/conversations', { body: { mode: 'coding' } });
    await this.context.workspaceState.update('sara.conversationId', c.id);
    return c.id;
  }

  async disclosure() {
    const me = await this.client.json('/device/whoami');
    if (me.disclosureAccepted) return true;
    const ok = await vscode.window.showInformationMessage(me.disclosure, { modal: true }, 'I understand');
    if (ok !== 'I understand') return false;
    await this.client.json('/disclosure/accept', { body: {} });
    return true;
  }

  /** Shows the panel and asks; `context` is the editor context (shown to the owner as sent). */
  async ask(question, context) {
    question = question.trim();
    if (!question) return;
    if (this.busy) return this.post({ type: 'error', message: 'She is still answering. Press Stop first.' });
    await vscode.commands.executeCommand('sara.chat.focus');
    const token = await this.client.token();
    if (!token) return this.post({ type: 'error', message: 'Sign in first: run "Sara: Sign in".' });
    const ctl = new AbortController();
    this.busy = { ctl, convId: undefined };
    try {
      if (!(await this.disclosure())) throw new Error('Accept the disclosure to chat.');
      const convId = await this.conversation();
      this.busy.convId = convId;
      this.post({ type: 'user', text: question, ...(context ? { context: context.summary, sent: context.text } : {}) });
      const content = context ? `${question}\n\n${context.text}` : question;
      const res = await this.client.request(`/conversations/${encodeURIComponent(convId)}/messages`, { body: { content }, signal: ctl.signal });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(res.status === 401 ? 'Not signed in (or this editor was signed out). Run "Sara: Sign in".' : data.error || `HTTP ${res.status}`);
      }
      this.post({ type: 'start', name: this.companion });
      for await (const ev of sseEvents(res.body)) {
        if (ev.type === 'token') this.post({ type: 'token', text: ev.text });
        else if (ev.type === 'tool_call') this.post({ type: 'tool', text: ev.summary || ev.name });
        else if (ev.type === 'tool_result' && ev.status !== 'ok') this.post({ type: 'tool', text: `${ev.status === 'denied' ? 'not allowed' : 'failed'}: ${String(ev.output || '').split('\n')[0].slice(0, 160)}` });
        else if (ev.type === 'approval') this.post({ type: 'approval', approvalId: ev.approvalId, text: ev.summary || ev.name });
        else if (ev.type === 'notice') this.post({ type: 'notice', text: ev.text });
        else if (ev.type === 'replace') this.post({ type: 'replace', text: ev.text });
        else if (ev.type === 'error') this.post({ type: 'error', message: ev.message });
      }
    } catch (err) {
      if (!(err && err.name === 'AbortError')) this.post({ type: 'error', message: err.message });
    } finally {
      this.busy = undefined;
      this.post({ type: 'done' });
    }
  }

  async stop() {
    const b = this.busy;
    if (!b || !b.convId) return;
    // Stopping on the server keeps what she wrote so far; the stream then ends by itself.
    await this.client.json(`/conversations/${encodeURIComponent(b.convId)}/stop`, { body: {} }).catch(() => undefined);
  }
}

async function signIn(context, client, panel) {
  const server = normalizeServer(
    (await vscode.window.showInputBox({ title: 'Sara: Sign in', prompt: "Your Sara server's address", value: client.server || 'https://', ignoreFocusOut: true, validateInput: (v) => (/^https?:\/\/[^/\s]+/i.test(v.trim()) ? undefined : 'An address like https://sara.example.com') })) || '',
  );
  if (!server) return;
  await vscode.workspace.getConfiguration('sara').update('server', server, vscode.ConfigurationTarget.Global);
  const name = `VS Code on ${os.platform() === 'win32' ? 'Windows' : os.platform() === 'darwin' ? 'Mac' : 'Linux'} (${os.hostname().slice(0, 30)})`;
  let start;
  try {
    start = await client.json('/device/start', { body: { name }, noAuth: true });
  } catch (err) {
    return vscode.window.showErrorMessage(`Sara: ${err.message}`);
  }
  panel.post({ type: 'notice', text: `Approve the code ${start.code} in ${start.approveIn}, or open ${start.verifyUrl} where you're signed in and type the code.` });
  const open = 'Open the approval page';
  void vscode.window.showInformationMessage(`Sara: approve the code ${start.code} (Settings → Devices and sign-in).`, open).then((pick) => {
    if (pick === open) void vscode.env.openExternal(vscode.Uri.parse(start.verifyUrl));
  });
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Sara: waiting for you to approve ${start.code}…`, cancellable: true }, async (_p, cancel) => {
    const until = Date.parse(start.expiresAt);
    while (Date.now() < until && !cancel.isCancellationRequested) {
      await new Promise((r) => setTimeout(r, Math.max(1, start.interval || 2) * 1000));
      const res = await client.request('/device/poll', { body: { pollToken: start.pollToken }, noAuth: true }).catch(() => undefined);
      if (!res) continue;
      const body = await res.json().catch(() => ({}));
      if (body.status === 'approved' && body.token) {
        await context.secrets.store(TOKEN_KEY, JSON.stringify({ token: body.token, server }));
        void vscode.window.showInformationMessage('Sara: signed in.');
        return void panel.refresh();
      }
      if (body.status === 'denied') return void vscode.window.showWarningMessage('Sara: the sign-in was denied.');
      if (res.status === 410) return void vscode.window.showWarningMessage('Sara: the code expired. Run "Sara: Sign in" again.');
    }
  });
}

function activate(context) {
  const client = new SaraClient(context);
  const panel = new SaraPanel(context, client);
  const max = () => Math.max(1000, Math.min(60000, Number(vscode.workspace.getConfiguration('sara').get('maxContextChars')) || 12000));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('sara.chat', panel, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('sara.signIn', () => signIn(context, client, panel)),
    vscode.commands.registerCommand('sara.signOut', async () => {
      if (await client.token()) await client.json('/device/logout', { body: {} }).catch(() => undefined);
      await context.secrets.delete(TOKEN_KEY);
      void vscode.window.showInformationMessage('Sara: signed out. This editor no longer has a token.');
      void panel.refresh();
    }),
    vscode.commands.registerCommand('sara.newConversation', async () => {
      await context.workspaceState.update('sara.conversationId', undefined);
      panel.post({ type: 'notice', text: 'The next message starts a new conversation.' });
    }),
    vscode.commands.registerCommand('sara.askSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return vscode.window.showWarningMessage('Sara: open a file and select some code first.');
      const ctx = editorContext(editor, { max: max() });
      if (ctx.refused) return vscode.window.showWarningMessage(`Sara: ${ctx.refused}`);
      const q = await vscode.window.showInputBox({ title: 'Ask Sara about the selection', prompt: `Sent with it: ${ctx.summary}`, value: 'What does this do, and is anything wrong with it?', ignoreFocusOut: true });
      if (q) await panel.ask(q, ctx);
    }),
    vscode.commands.registerCommand('sara.explainFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return vscode.window.showWarningMessage('Sara: open a file first.');
      const ctx = editorContext(editor, { max: max(), whole: true });
      if (ctx.refused) return vscode.window.showWarningMessage(`Sara: ${ctx.refused}`);
      await panel.ask('Explain this file: what it is for, how it works, and anything that looks wrong.', ctx);
    }),
    vscode.commands.registerCommand('sara.sendToLibrary', async (uri) => {
      const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
      if (!target) return vscode.window.showWarningMessage('Sara: pick a file (right-click it in the Explorer) or open one.');
      const name = path.basename(target.fsPath || target.path);
      if (SECRET_FILE.test(name)) return vscode.window.showWarningMessage(`Sara: ${name} looks like a secret (keys, .env, passwords), so it isn't sent.`);
      try {
        const bytes = Buffer.from(await vscode.workspace.fs.readFile(target));
        const r = await client.json(`/library?${new URLSearchParams({ name, keep: '1' })}`, { bytes });
        void vscode.window.showInformationMessage(`Sara: ${r.already ? 'already in' : 'added to'} her library: ${r.doc.name}. She reads it in the background.`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Sara: ${err.message}`);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sara.server')) void panel.refresh();
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, normalizeServer, parseSaved, tokenForServer, sseEvents, SECRET_FILE };
