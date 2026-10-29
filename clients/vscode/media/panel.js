// The Sara panel's page. It only shows what the extension sends and passes your input back;
// it has no network access of its own (see the Content-Security-Policy).
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);
  const log = $('#log');
  let reply = null;
  let name = 'Sara';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const add = (node) => {
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  };
  const busy = (on) => {
    $('#send').disabled = on;
    $('#stop').hidden = !on;
  };
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    switch (m.type) {
      case 'state':
        name = m.companion || name;
        $('#signin').hidden = m.signedIn;
        $('#status').textContent = m.signedIn ? `${name} · ${m.serverName && m.serverName !== name ? `${m.serverName} · ` : ''}${m.server}` : m.error ? m.error : 'Not signed in. Press Sign in (or run "Sara: Sign in").';
        $('#switch').hidden = !(m.servers > 1);
        break;
      case 'clear':
        // Another server: its conversation isn't this one.
        log.replaceChildren();
        reply = null;
        busy(false);
        break;
      case 'user': {
        const b = add(el('div', 'msg user'));
        b.append(el('div', 'who', 'You'), el('div', 'text', m.text));
        if (m.context) {
          const d = el('details', 'sent');
          d.append(el('summary', '', `Sent with it: ${m.context}`), el('pre', '', m.sent || ''));
          b.append(d);
        }
        reply = null;
        busy(true);
        break;
      }
      case 'start':
        name = m.name || name;
        break;
      case 'token':
        if (!reply) {
          reply = add(el('div', 'msg her'));
          reply.append(el('div', 'who', name), el('div', 'text', ''));
        }
        reply.lastChild.textContent += m.text;
        log.scrollTop = log.scrollHeight;
        break;
      case 'replace':
        if (reply) reply.lastChild.textContent = m.text;
        break;
      case 'tool':
        add(el('div', 'tool', `· ${m.text}`));
        reply = null;
        break;
      case 'approval': {
        const box = add(el('div', 'approval'));
        box.append(el('div', '', `${name} wants to: ${m.text}`));
        for (const [label, ok] of [['Allow', true], ['Decline', false]]) {
          const b = el('button', ok ? '' : 'ghost', label);
          b.type = 'button';
          b.addEventListener('click', () => {
            vscode.postMessage({ type: 'approve', approvalId: m.approvalId, approved: ok });
            box.replaceChildren(el('div', 'muted', `${ok ? 'Allowed' : 'Declined'}: ${m.text}`));
          });
          box.append(b);
        }
        reply = null;
        break;
      }
      case 'notice':
        add(el('div', 'notice', m.text));
        break;
      case 'error':
        add(el('div', 'error', m.message));
        break;
      case 'done':
        reply = null;
        busy(false);
        break;
    }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#input').value.trim();
    if (!text) return;
    $('#input').value = '';
    vscode.postMessage({ type: 'send', text });
  });
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  $('#new').addEventListener('click', () => vscode.postMessage({ type: 'new' }));
  $('#signin').addEventListener('click', () => vscode.postMessage({ type: 'signIn' }));
  $('#switch').addEventListener('click', () => vscode.postMessage({ type: 'switch' }));
})();
