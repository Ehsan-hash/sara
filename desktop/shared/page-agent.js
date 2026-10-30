// Sara's page agent (Phase 87, docs/design/COMPUTER_USE.md §4.2): the ONE fixed script that reads a
// web page for her. It is used by the server's testing browser (src/browser.ts), by the reference
// hands (src/hands-ref.ts) and by the Sara browser of the Windows and Mac apps (bundled into each).
// It only reads the page or finds an element and its position: clicks and typing are real input
// events sent through the DevTools protocol by the code that runs it. No other expression is ever
// evaluated in a page by Sara: callers run exactly this file followed by `.call("<name>", <json>)`.
//
// The file is one expression (no trailing semicolon) so callers can write `(<file>).call(n, args)`.
// Rules kept here for every caller: password and other secret fields never give their value (not as
// a value, not as a name), and text that looks like a key or token is masked before it leaves.
(function () {
  'use strict';
  var SECRET_SHAPES = [
    /\bsk-[A-Za-z0-9_-]{16,}/g,
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bAIza[0-9A-Za-z_-]{30,}/g,
    /\bxai-[A-Za-z0-9]{20,}/g,
    /\bsara_(?:dev|hands|m)\.[\w-]+\.[\w-]+/g,
    /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  ];
  function mask(s) {
    var t = String(s == null ? '' : s);
    for (var i = 0; i < SECRET_SHAPES.length; i++) t = t.replace(SECRET_SHAPES[i], '[hidden]');
    return t;
  }
  function isSecretField(e) {
    if (!e || e.tagName !== 'INPUT') return false;
    var type = String(e.type || '').toLowerCase();
    var ac = String(e.getAttribute('autocomplete') || '').toLowerCase();
    return type === 'password' || /password|one-time-code|cc-number|cc-csc|cc-exp/.test(ac);
  }
  function vis(el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  }
  function name(e) {
    var v = isSecretField(e) ? '' : e.value;
    return String(e.getAttribute('aria-label') || e.innerText || v || e.title || e.getAttribute('placeholder') || e.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
  }
  function desc(e) {
    var t = e.tagName.toLowerCase();
    var n = name(e).slice(0, 60);
    return (e.id ? t + '#' + e.id : t) + (n ? ' "' + n + '"' : '');
  }

  // Finds an element by CSS selector or its visible text (the testing browser's click/type).
  function find(a) {
    var el = null;
    if (a.selector) {
      try {
        var all = Array.prototype.slice.call(document.querySelectorAll(a.selector));
        el = all.find(vis) || all[0] || null;
      } catch (e) {
        if (!a.text) return { error: 'That is not a valid CSS selector.' };
      }
    }
    if (!el && a.text) {
      var want = a.text.replace(/\s+/g, ' ').trim().toLowerCase();
      var pool = a.field ? 'input, textarea, select, [contenteditable=""], [contenteditable=true]' : 'button, a, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], input[type=submit], input[type=button], input[type=checkbox], input[type=radio], summary, label, [onclick]';
      var cands = Array.prototype.slice.call(document.querySelectorAll(pool)).filter(vis);
      var labelOf = function (e) {
        var l = e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]');
        return String((l && l.innerText) || (e.closest('label') && e.closest('label').innerText) || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
      };
      var key = function (e) { return a.field ? labelOf(e) : name(e).toLowerCase(); };
      el = cands.find(function (e) { return key(e) === want; }) || cands.find(function (e) { return key(e).indexOf(want) >= 0; }) || null;
      if (!el && !a.field) {
        var leaves = Array.prototype.slice.call(document.querySelectorAll('body *')).filter(function (e) { return !e.children.length && vis(e); });
        var tx = function (e) { return String(e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
        el = leaves.find(function (e) { return tx(e) === want; }) || leaves.find(function (e) { return tx(e).indexOf(want) >= 0; }) || null;
      }
    }
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var top = document.elementFromPoint(x, y);
    var covered = top && top !== el && !el.contains(top) && !top.contains(el) ? desc(top) : '';
    if (a.focus) {
      el.focus();
      if (el.select && el.tagName !== 'SELECT') el.select();
      if (el.tagName === 'SELECT' && a.value !== undefined) {
        var w = String(a.value).toLowerCase();
        var o = Array.prototype.slice.call(el.options).find(function (o) { return o.text.trim().toLowerCase() === w || o.value.toLowerCase() === w; });
        if (!o) return { found: true, desc: desc(el), error: 'No option "' + a.value + '" in that list.' };
        el.value = o.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, desc: desc(el), selected: o.text.trim() };
      }
    }
    return { found: true, x: x, y: y, desc: desc(el), covered: covered, disabled: Boolean(el.disabled), secret: isSecretField(el) };
  }

  // The page's text and a short list of its controls (the testing browser's browser_read).
  function read(a) {
    var root = document.body;
    if (a.selector) {
      try { root = document.querySelector(a.selector); } catch (e) { return { error: 'That is not a valid CSS selector.' }; }
      if (!root) return { error: 'Nothing matches ' + a.selector + '.' };
    }
    var max = a.max || 6000;
    var text = mask(String((root && root.innerText) || '').replace(/\n{3,}/g, '\n\n').trim());
    var hint = function (e) { var t = e.tagName.toLowerCase(); if (e.id) return '#' + e.id; if (e.name) return t + '[name="' + e.name + '"]'; return t; };
    var controls = [];
    var list = root ? root.querySelectorAll('a[href], button, [role=button], input, textarea, select, summary') : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (controls.length >= 50) break;
      if (!vis(e) || e.type === 'hidden') continue;
      var t = e.tagName.toLowerCase();
      var kind = t === 'a' ? 'link' : t === 'input' ? 'input:' + (e.type || 'text') : t === 'select' ? 'list' : t === 'textarea' ? 'text box' : 'button';
      var label = (e.labels && e.labels[0] && e.labels[0].innerText) || name(e);
      var extra = t === 'a' ? ' → ' + String(e.getAttribute('href') || '').slice(0, 80) : (t === 'input' || t === 'textarea') && !isSecretField(e) && e.value ? ' = "' + String(e.value).slice(0, 40) + '"' : t === 'select' && e.selectedOptions[0] ? ' = "' + e.selectedOptions[0].text.trim().slice(0, 40) + '"' : '';
      controls.push(mask(kind + ' "' + String(label).replace(/\s+/g, ' ').trim().slice(0, 60) + '" (' + hint(e) + ')' + extra + (e.disabled ? ' [disabled]' : '')));
    }
    return { title: mask(document.title), url: location.pathname + location.search, text: text.slice(0, max), more: text.length > max, controls: controls, width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  }

  // Script-free assertions (the testing browser's browser_check).
  function check(checks) {
    var body = String((document.body && document.body.innerText) || '').toLowerCase();
    var q = function (s) { try { return Array.prototype.slice.call(document.querySelectorAll(s)); } catch (e) { return null; } };
    return checks.map(function (c) {
      var t = String(c.text || '').toLowerCase();
      var l;
      switch (c.type) {
        case 'text_visible': return { ok: body.indexOf(t) >= 0 };
        case 'text_absent': return { ok: body.indexOf(t) < 0 };
        case 'element_exists': l = q(c.selector); return l ? { ok: l.length > 0, detail: l.length + ' found' } : { ok: false, detail: 'bad selector' };
        case 'element_visible': l = q(c.selector); return l ? { ok: l.some(vis), detail: l.length + ' found, ' + l.filter(vis).length + ' visible' } : { ok: false, detail: 'bad selector' };
        case 'element_hidden': l = q(c.selector); return l ? { ok: !l.some(vis) } : { ok: false, detail: 'bad selector' };
        case 'count_at_least': l = q(c.selector); return l ? { ok: l.length >= Number(c.count || 1), detail: l.length + ' found' } : { ok: false, detail: 'bad selector' };
        case 'title_contains': return { ok: document.title.toLowerCase().indexOf(t) >= 0, detail: 'title: ' + document.title.slice(0, 80) };
        case 'url_contains': return { ok: (location.pathname + location.search).toLowerCase().indexOf(t) >= 0, detail: location.pathname };
        case 'no_horizontal_scroll': { var w = document.documentElement.scrollWidth; return { ok: w <= innerWidth + 1, detail: 'page ' + w + 'px wide, window ' + innerWidth + 'px' }; }
        case 'input_value': { l = q(c.selector); if (l && l[0] && isSecretField(l[0])) return { ok: false, detail: 'a password field (never read)' }; var v = l && l[0] ? String(l[0].value) : null; return { ok: v !== null && v.toLowerCase().indexOf(t) >= 0, detail: v === null ? 'not found' : 'value: ' + v.slice(0, 60) }; }
        default: return { ok: false, detail: 'unknown check' };
      }
    });
  }

  // ---- The hands' element list (b.snapshot) and visible text (b.read) ----
  var INTERACTIVE = 'a[href], button, input, textarea, select, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=textbox], [role=option], [contenteditable=""], [contenteditable=true], h1, h2, h3, h4, h5, h6, img[alt], [role=heading], [role=alert], [role=dialog]';
  function roleOf(e) {
    var r = e.getAttribute('role');
    if (r) return r;
    var t = e.tagName.toLowerCase();
    if (t === 'a') return 'link';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'img') return 'img';
    if (t === 'input') {
      var ty = String(e.type || 'text').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio') return ty;
      if (ty === 'submit' || ty === 'button' || ty === 'reset' || ty === 'image') return 'button';
      if (ty === 'password') return 'password';
      return 'textbox';
    }
    if (e.isContentEditable) return 'textbox';
    return t;
  }
  function labelFor(e) {
    var l = e.labels && e.labels[0] && e.labels[0].innerText;
    var by = e.getAttribute('aria-labelledby');
    var lb = by ? by.split(/\s+/).map(function (id) { var x = document.getElementById(id); return x ? x.innerText : ''; }).join(' ') : '';
    return String(e.getAttribute('aria-label') || lb || l || '').replace(/\s+/g, ' ').trim();
  }
  function elements() {
    var out = [];
    var list = document.querySelectorAll(INTERACTIVE);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.type === 'hidden' || !vis(e)) continue;
      out.push(e);
    }
    return out;
  }
  function itemOf(e, i) {
    var role = roleOf(e);
    var secret = isSecretField(e);
    var nm = labelFor(e) || (role === 'textbox' || role === 'password' || role === 'combobox' ? String(e.getAttribute('placeholder') || e.name || '') : name(e));
    var it = { ref: 'e' + (i + 1), role: role, name: mask(String(nm).replace(/\s+/g, ' ').trim().slice(0, 80)) };
    var r = e.getBoundingClientRect();
    it.box = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    var t = e.tagName;
    if (secret) it.secret = true;
    else if (t === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio')) it.checked = Boolean(e.checked);
    else if (t === 'INPUT' || t === 'TEXTAREA') { if (e.value) it.value = mask(String(e.value).slice(0, 80)); }
    else if (t === 'SELECT' && e.selectedOptions && e.selectedOptions[0]) it.value = mask(e.selectedOptions[0].text.trim().slice(0, 80));
    if (t === 'A') it.href = mask(String(e.getAttribute('href') || '').slice(0, 120));
    if (e.disabled) it.disabled = true;
    var ex = e.getAttribute('aria-expanded');
    if (ex === 'true' || ex === 'false') it.expanded = ex === 'true';
    if (/^H[1-6]$/.test(t)) it.level = Number(t.slice(1));
    return it;
  }
  function snapshot(a) {
    var from = Math.max(0, Number(a.from) || 0);
    var limit = Math.min(400, Math.max(1, Number(a.limit) || 400));
    var els = elements();
    var items = [];
    for (var i = from; i < els.length && items.length < limit; i++) items.push(itemOf(els[i], i));
    return { title: mask(document.title), url: location.href, items: items, total: els.length, more: from + items.length < els.length, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
  }
  function text(a) {
    var max = Math.min(20000, Math.max(200, Number(a.max) || 8000));
    var root = document.body;
    if (a.ref) {
      var n = Number(String(a.ref).replace(/^e/, '')) - 1;
      var els = elements();
      if (!(n >= 0 && n < els.length)) return { error: 'No element ' + a.ref + ' on the page now: look again.' };
      root = els[n];
      if (isSecretField(root)) return { error: 'That is a password field: its value is never read.' };
    }
    var raw = String((root && root.innerText) || (root && !isSecretField(root) && root.value) || '').replace(/\n{3,}/g, '\n\n').trim();
    var t = mask(raw);
    return { title: mask(document.title), url: location.href, text: t.slice(0, max), more: t.length > max };
  }

  var API = { find: find, read: read, check: check, snapshot: snapshot, text: text };
  return {
    version: 1,
    call: function (fn, args) {
      if (!Object.prototype.hasOwnProperty.call(API, fn)) return { error: 'unknown page-agent function' };
      return API[fn](args || {});
    },
  };
})()
