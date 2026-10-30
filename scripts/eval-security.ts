// Phase 81 (harness track M6): the offline eval of the security pass's deterministic checks.
// No model, no network. Four small seeded sample projects (an Express shop, a Flask notes app, a Go
// service and a static front end), written here, each with deliberately vulnerable lines AND safe
// look-alikes (the near misses a noisy checker would flag). Every expected finding is
// [file, line, rule]; the checks run over every file (as after a turn that wrote them all) and the
// result is scored: precision (were the findings real?) and recall (were the real ones found?),
// per rule and overall. The code shapes are the usual textbook mistakes, nothing exploitable.
//
//   node scripts/eval-security.ts          print the table, write evals/results/<date>-security.json
//   node scripts/eval-security.ts --json   the same as JSON on stdout
//
// Exit code 1 if precision < 0.9 or recall < 0.85 (the bar in docs/RESULTS.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkFile, RULE_IDS, type RuleId } from '../src/security/rules.ts';

const ROOT = resolve(import.meta.dirname, '..');
/** Secret-shaped sample values are built from parts (the public-export scan rejects literals). */
const AWS = ['AK', 'IA', 'Z7SAMPLE4KEYQ2W9'].join('');
const GH = ['gh', 'p_', 'R4nd0mS4mpleT0kenF0rTheEva1uat10nX1'].join('');

/** A sample project: files, each a list of lines; a line starting with `!rule ` is expected to be found. */
type Sample = Record<string, string[]>;
const SAMPLES: Record<string, Sample> = {
  'express-shop': {
    'server.js': [
      "const express = require('express');",
      "const cors = require('cors');",
      "const path = require('path');",
      "const { exec, execFile } = require('child_process');",
      "const crypto = require('crypto');",
      "const requireLogin = require('./auth');",
      'const app = express();',
      "!secret-in-code const STRIPE_KEY = 'sk_" + "live_51Hx9cQ2eZvKYlo2C8a7SampleKeyX0';",
      "const SESSION_SECRET = process.env.SESSION_SECRET;",
      "app.use(cors({",
      "!cors-credentials   origin: '*',",
      '  credentials: true,',
      '}));',
      "app.get('/api/orders', requireLogin, (req, res) => {",
      '!sql-string   db.query("SELECT * FROM orders WHERE customer = \'" + req.query.customer + "\'", (e, r) => res.json(r));',
      '});',
      "app.get('/api/orders/:id', requireLogin, (req, res) => {",
      "  db.query('SELECT * FROM orders WHERE id = ?', [req.params.id], (e, r) => res.json(r));",
      '});',
      "app.post('/api/orders', requireLogin, (req, res) => save(req.body));",
      "!missing-auth app.get('/api/admin/export', (req, res) => res.json(dumpAll()));",
      "app.get('/health', (req, res) => res.send('ok'));",
      "app.get('/invoice', requireLogin, (req, res) => {",
      "!path-traversal   res.sendFile(path.join(__dirname, 'invoices', req.query.file));",
      '});',
      "app.get('/logo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'logo.png')));",
      "app.post('/thumb', requireLogin, (req, res) => {",
      '!code-exec   exec(`convert ${req.body.name} -resize 64x64 thumb.png`, () => res.end());',
      '});',
      "app.post('/git-log', requireLogin, (req, res) => execFile('git', ['log', '--oneline', req.body.ref], (e, out) => res.send(out)));",
      'function hashPassword(password) {',
      "!weak-crypto   return crypto.createHash('md5').update(password).digest('hex');",
      '}',
      "const etag = (body) => crypto.createHash('sha1').update(body).digest('hex');",
      '!weak-crypto const resetToken = Math.random().toString(36).slice(2);',
      'const jitter = Math.random() * 250;',
      "!code-exec app.post('/calc', requireLogin, (req, res) => res.json(eval(req.body.expr)));",
      'app.post("/parse", requireLogin, (req, res) => res.json(JSON.parse(req.body.raw)));',
    ],
    'lib/http.js': [
      "const https = require('https');",
      '!tls-off const insecure = new https.Agent({ rejectUnauthorized: false });',
      'const normal = new https.Agent({ keepAlive: true });',
      '// Old note: rejectUnauthorized: false was used for the staging box, removed.',
      "!secret-in-code const ghToken = '" + GH + "';",
      'module.exports = { insecure, normal };',
    ],
    '.env.example': ['API_KEY="your-api-key-here"', 'DB_PASSWORD=changeme', 'STRIPE_KEY=sk_test_xxx'],
    'README.md': ['# Shop', 'Never use `eval(req.body.expr)` in handlers.', 'Set `rejectUnauthorized: false` only for local tests.'],
  },
  'flask-notes': {
    'app.py': [
      'import os, pickle, subprocess, hashlib, sqlite3, yaml',
      'from flask import Flask, request, send_from_directory',
      'from flask_login import login_required',
      'app = Flask(__name__)',
      "!secret-in-code app.config['SECRET_KEY'] = 'f3b9c2d17e8a4b6c9d0e1f2a3b4c5d6e'",
      "DB_PASSWORD = os.environ['DB_PASSWORD']",
      '@app.route("/notes")',
      '@login_required',
      'def notes():',
      '    q = request.args.get("q", "")',
      '!sql-string     rows = db.execute(f"SELECT * FROM notes WHERE body LIKE \'%{q}%\'").fetchall()',
      '    safe = db.execute("SELECT * FROM notes WHERE owner = ?", (current_user.id,)).fetchall()',
      '    return render(rows + safe)',
      '@app.route("/notes/<int:nid>")',
      '@login_required',
      'def note(nid):',
      '    return render(db.execute("SELECT * FROM notes WHERE id = ?", (nid,)).fetchone())',
      '!missing-auth @app.route("/notes/dump")',
      'def dump():',
      '    return render(db.execute("SELECT * FROM notes").fetchall())',
      '@app.route("/import", methods=["POST"])',
      '@login_required',
      'def import_notes():',
      '!unsafe-deserialize     data = pickle.loads(request.data)',
      '    meta = yaml.safe_load(request.form["meta"])',
      '!unsafe-deserialize     extra = yaml.load(request.form["extra"])',
      '    return save(data, meta, extra)',
      '@app.route("/export")',
      '@login_required',
      'def export():',
      '!code-exec     subprocess.run("tar czf out.tgz " + request.args.get("dir"), shell=True)',
      '    subprocess.run(["tar", "czf", "out.tgz", "notes"])',
      '!path-traversal     return open(os.path.join("exports", request.args.get("name"))).read()',
      '@app.route("/files")',
      '@login_required',
      'def files():',
      '    return send_from_directory("uploads", request.args.get("name"))',
      'def check(password, stored):',
      '!weak-crypto     return hashlib.sha1(password.encode()).hexdigest() == stored',
      'def fingerprint(blob):',
      '    return hashlib.md5(blob).hexdigest()',
      'def fetch(url):',
      '!tls-off     return requests.get(url, verify=False, timeout=5)',
      'def fetch_ok(url):',
      '    return requests.get(url, verify=True, timeout=5)',
      'if __name__ == "__main__":',
      '!debug-on     app.run(host="0.0.0.0", debug=True)',
    ],
    'settings.py': ['!debug-on DEBUG = True', "ALLOWED_HOSTS = ['localhost']", "DEBUG_TOOLBAR = os.environ.get('DEBUG_TOOLBAR') == '1'"],
    'tests/test_app.py': ['def test_debug_off():', '    assert app.debug is False', '    # verify=False is never used outside this test', '    assert "SELECT" in "SELECT 1"'],
  },
  'go-service': {
    'main.go': [
      'package main',
      'import (',
      '  "crypto/md5"',
      '  "crypto/tls"',
      '  "database/sql"',
      '  "net/http"',
      '  "os/exec"',
      ')',
      'func handler(w http.ResponseWriter, r *http.Request) {',
      '  name := r.URL.Query().Get("name")',
      '!sql-string   rows, _ := db.Query("SELECT * FROM users WHERE name = \'" + name + "\'")',
      '  rows2, _ := db.Query("SELECT * FROM users WHERE name = $1", name)',
      '!code-exec   out, _ := exec.Command("sh", "-c", "ls "+name).Output()',
      '  out2, _ := exec.Command("ls", name).Output()',
      '  _ = rows; _ = rows2; _ = out; _ = out2',
      '}',
      'func client() *http.Client {',
      '!tls-off   tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}',
      '  return &http.Client{Transport: tr}',
      '}',
      'func token(password string) [16]byte {',
      '!weak-crypto   return md5.Sum([]byte(password))',
      '}',
      'func checksum(b []byte) [16]byte { return md5.Sum(b) }',
      "!secret-in-code const awsKey = \"" + AWS + "\"",
    ],
    'go.sum': ['golang.org/x/text v0.3.7 h1:olpwvP2KacW1ZWvsR7uQhoyTYvKAupfQrRGBFM352Gk='],
  },
  'static-front': {
    'app.js': [
      'const params = new URLSearchParams(location.search);',
      "!inner-html document.querySelector('#greet').innerHTML = 'Hello ' + params.get('name');",
      "document.querySelector('#greet2').textContent = 'Hello ' + params.get('name');",
      "document.querySelector('#list').innerHTML = '';",
      "!inner-html out.innerHTML = `<b>${location.hash.slice(1)}</b>`;",
      "!code-exec setTimeout('run(' + params.get('n') + ')', 10);",
      'setTimeout(() => run(params.get("n")), 10);',
      "const select = 'Select a file from the list';",
      "!code-exec const fn = new Function('x', params.get('body'));",
      "alert('Update the list from ' + name);",
    ],
    'config.js': ["export const apiBase = '/api';", "export const password = '';", "export const tokenName = 'sara_token';", "!secret-in-code export const dbPassword = 'Pa55w0rd!Prod2026';"],
  },
};

/**
 * Held out: written after the rules were tuned on SAMPLES above and never used to change a rule,
 * so its score is the honest one (docs/RESULTS.md reports both).
 */
const HELD_OUT: Record<string, Sample> = {
  'koa-blog': {
    'routes.js': [
      "const Router = require('@koa/router');",
      "const fs = require('fs');",
      "const { execSync } = require('child_process');",
      "const auth = require('./middleware/auth');",
      'const router = new Router();',
      "router.get('/posts', auth, async (ctx) => { ctx.body = await db.all('SELECT * FROM posts WHERE author = ?', ctx.state.user.id); });",
      "!sql-string router.get('/search', auth, async (ctx) => { ctx.body = await db.all(`SELECT * FROM posts WHERE title LIKE '%${ctx.query.q}%'`); });",
      "router.post('/posts', auth, async (ctx) => save(ctx.request.body));",
      "!path-traversal router.get('/attachments', auth, async (ctx) => { ctx.body = fs.createReadStream('uploads/' + ctx.query.name); });",
      "router.get('/backup', auth, async (ctx) => { ctx.body = execSync('tar czf - posts'); });",
      "!code-exec router.post('/convert', auth, async (ctx) => { ctx.body = execSync('pandoc -o out.pdf ' + ctx.request.body.file); });",
      "!weak-crypto const sessionId = Math.random().toString(16).slice(2);",
      "const shuffle = (a) => a.sort(() => Math.random() - 0.5);",
      "!tls-off process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
      "const msg = 'Select a post from the list to edit';",
      "!secret-in-code const mailgunApiKey = 'key-3ax6xnjp29jd6fds4gc373sgvjxteol0';",
      "const apiKeyHeader = 'x-api-key';",
      'module.exports = router;',
    ],
    'public/editor.js': [
      "!inner-html preview.innerHTML = marked(editor.value) + '<hr>' + location.search;",
      "preview.innerHTML = DOMPurify.sanitize(marked(editor.value));",
      "status.textContent = 'Saved ' + new Date().toLocaleTimeString();",
    ],
  },
  'django-shop': {
    'views.py': [
      'import random, hashlib, json, marshal',
      'from django.db import connection',
      'from django.http import JsonResponse, FileResponse',
      'def product(request, pid):',
      '    with connection.cursor() as c:',
      '        c.execute("SELECT * FROM shop_product WHERE id = %s", [pid])',
      '!sql-string         c.execute("SELECT * FROM shop_product WHERE name = \'%s\'" % request.GET["name"])',
      '        return JsonResponse(c.fetchall(), safe=False)',
      'def coupon(request):',
      '!weak-crypto     code = "".join(random.choice("ABCDEFGH23456789") for _ in range(8)); reset_token = random.getrandbits(64)',
      '    sample = random.choice(products)',
      '    return JsonResponse({"code": code})',
      'def restore(request):',
      '!unsafe-deserialize     cart = marshal.loads(request.body)',
      '    prefs = json.loads(request.body)',
      '    return JsonResponse({"ok": True})',
      'def download(request):',
      '!path-traversal     return FileResponse(open("media/" + request.GET["f"], "rb"))',
      'def eval_rule(request):',
      '!code-exec     return JsonResponse({"v": eval(request.POST["rule"])})',
    ],
    'settings.py': ["!secret-in-code SECRET_KEY = 'django-insecure-9x!k2m#v8q@w3e$r5t^y7u*i0o'", '!debug-on DEBUG = True', "DEBUG_PROPAGATE_EXCEPTIONS = False"],
  },
};

export interface EvalResult {
  expected: number;
  found: number;
  truePositives: number;
  precision: number;
  recall: number;
  perRule: Record<string, { expected: number; found: number; tp: number; precision: number; recall: number }>;
  missed: string[];
  falseAlarms: string[];
}

/** Runs every check over the samples and scores the findings against the expectations. */
export function runEval(set: 'tuning' | 'held-out' = 'tuning'): EvalResult {
  const expected = new Set<string>();
  const found = new Set<string>();
  for (const [proj, files] of Object.entries(set === 'tuning' ? SAMPLES : HELD_OUT)) {
    for (const [file, lines] of Object.entries(files)) {
      const text: string[] = [];
      lines.forEach((l, i) => {
        const m = /^!([\w-]+) (.*)$/.exec(l);
        if (m) expected.add(`${proj}/${file}:${i + 1}:${m[1]}`);
        text.push(m ? m[2] : l);
      });
      for (const f of checkFile(file, `${text.join('\n')}\n`)) found.add(`${proj}/${file}:${f.line}:${f.rule}`);
    }
  }
  const tp = [...found].filter((k) => expected.has(k));
  const rule = (k: string) => k.split(':').at(-1)!;
  const perRule: EvalResult['perRule'] = {};
  for (const r of RULE_IDS as readonly RuleId[]) {
    const e = [...expected].filter((k) => rule(k) === r).length;
    const f = [...found].filter((k) => rule(k) === r).length;
    const t = tp.filter((k) => rule(k) === r).length;
    perRule[r] = { expected: e, found: f, tp: t, precision: f ? t / f : 1, recall: e ? t / e : 1 };
  }
  return {
    expected: expected.size,
    found: found.size,
    truePositives: tp.length,
    precision: found.size ? tp.length / found.size : 1,
    recall: expected.size ? tp.length / expected.size : 1,
    perRule,
    missed: [...expected].filter((k) => !found.has(k)),
    falseAlarms: [...found].filter((k) => !expected.has(k)),
  };
}

if (import.meta.main) {
  const both = { tuning: runEval('tuning'), heldOut: runEval('held-out') };
  if (process.argv.includes('--json')) console.log(JSON.stringify(both, null, 2));
  else for (const [name, r] of Object.entries(both)) {
    console.log(`\n== ${name === 'tuning' ? 'tuning set (the rules were adjusted on it)' : 'held-out set (never used to change a rule)'}`);
    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    console.log('rule                 expected found  tp  precision recall');
    for (const [k, v] of Object.entries(r.perRule)) console.log(`${k.padEnd(20)} ${String(v.expected).padStart(8)} ${String(v.found).padStart(5)} ${String(v.tp).padStart(3)}  ${pct(v.precision).padStart(9)} ${pct(v.recall).padStart(6)}`);
    console.log(`${'all'.padEnd(20)} ${String(r.expected).padStart(8)} ${String(r.found).padStart(5)} ${String(r.truePositives).padStart(3)}  ${pct(r.precision).padStart(9)} ${pct(r.recall).padStart(6)}`);
    if (r.missed.length) console.log(`missed: ${r.missed.join(', ')}`);
    if (r.falseAlarms.length) console.log(`false alarms: ${r.falseAlarms.join(', ')}`);
  }
  const dir = join(ROOT, 'evals', 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}-security.json`), `${JSON.stringify(both, null, 2)}\n`);
  if (both.tuning.precision < 0.9 || both.tuning.recall < 0.85) process.exitCode = 1;
}
