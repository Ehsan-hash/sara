// Phase 82 (harness track M7): the offline eval of the threat pass's deterministic rules
// (src/security/threat-graph.ts). No model, no network, nothing runs. Seeded multi-file sample
// projects, written here: the entry point in one file and the sink in another, with deliberately
// unguarded paths AND guarded look-alikes (placeholders, basename / root checks, allowlists, fixed
// hosts, escaping, local redirects, sign-in middleware, rate limiters). A sink line starting with
// `!<kind> ` is expected to be reported as a threat of that kind (the marker is removed first).
// Scored per (kind, file, line): precision (were the threats real?) and recall (were the real ones
// found?). The code shapes are the usual textbook mistakes, nothing exploitable.
//
// Two sets: "tuning" (the rules were tuned on it) and "held-out" (written after the tuning, with
// other frameworks and shapes, not used to change the rules).
//
//   node scripts/eval-threat.ts          print the table, write evals/results/<date>-threat.json
//   node scripts/eval-threat.ts --json   the same as JSON on stdout
//
// Exit code 1 if the tuning set is under precision 0.9 / recall 0.85 (the bar in docs/RESULTS.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyze, THREAT_KINDS, type ThreatKind } from '../src/security/threat-graph.ts';

const ROOT = resolve(import.meta.dirname, '..');

type Sample = Record<string, string[]>;

const TUNING: Record<string, Sample> = {
  'express-docs': {
    'server.js': [
      "const express = require('express');",
      "const rateLimit = require('express-rate-limit');",
      "const docs = require('./lib/docs');",
      "const users = require('./lib/users');",
      "const { fetchPreview } = require('./lib/preview');",
      "const requireLogin = require('./lib/auth');",
      'const app = express();',
      "app.get('/docs/:name', (req, res) => res.send(docs.read(req.params.name)));",
      "app.get('/docs2/:name', (req, res) => res.send(docs.readChecked(req.params.name)));",
      "app.get('/users', requireLogin, async (req, res) => res.json(await users.find(req.query.name)));",
      "app.get('/users/:id', requireLogin, async (req, res) => res.json(await users.byId(req.params.id)));",
      "app.post('/admin/purge', async (req, res) => res.json(await users.purge()));",
      "app.post('/admin/purge2', requireLogin, async (req, res) => res.json(await users.purge()));",
      "app.get('/preview', requireLogin, async (req, res) => res.send(await fetchPreview(req.query.url)));",
      "app.get('/weather', async (req, res) => res.json(await fetchPreview('https://api.weather.example/v1?q=' + encodeURIComponent(req.query.city))));",
      "!redirect app.get('/out', (req, res) => res.redirect(req.query.to));",
      "app.get('/back', (req, res) => res.redirect('/home?tab=' + encodeURIComponent(req.query.tab)));",
      "app.post('/login', async (req, res) => res.json(await users.login(req.body.user, req.body.password)));",
      "app.post('/login2', rateLimit({ max: 5 }), async (req, res) => res.json(await users.login(req.body.user, req.body.password)));",
      "!secret app.get('/debug', (req, res) => res.json({ env: process.env }));",
      "app.get('/mode', (req, res) => res.json({ mode: process.env.NODE_ENV }));",
    ],
    'lib/docs.js': [
      "const fs = require('fs');",
      "const path = require('path');",
      "const ROOT = path.join(__dirname, '..', 'docs');",
      'function read(name) {',
      '  const file = path.join(ROOT, name);',
      "!path   return fs.readFileSync(file, 'utf8');",
      '}',
      'function readChecked(name) {',
      '  const file = path.resolve(ROOT, name);',
      "  if (!file.startsWith(ROOT + path.sep)) throw new Error('outside the docs folder');",
      "  return fs.readFileSync(file, 'utf8');",
      '}',
      'module.exports = { read, readChecked };',
    ],
    'lib/users.js': [
      "const db = require('./db');",
      "const bcrypt = require('bcrypt');",
      'async function find(name) {',
      "!sql   return db.query(`SELECT id, name FROM users WHERE name LIKE '%${name}%'`);",
      '}',
      'async function byId(id) {',
      "  return db.query('SELECT id, name FROM users WHERE id = $1', [id]);",
      '}',
      'async function purge() {',
      "!auth   return db.query('DELETE FROM users WHERE disabled = true');",
      '}',
      'async function login(user, password) {',
      "  const row = await db.query('SELECT hash FROM users WHERE name = $1', [user]);",
      '!ratelimit   return row && (await bcrypt.compare(password, row.hash));',
      '}',
      'module.exports = { find, byId, purge, login };',
    ],
    'lib/preview.js': ['async function fetchPreview(url) {', '!ssrf   const r = await fetch(url);', '  return r.text();', '}', 'module.exports = { fetchPreview };'],
    'lib/debug-note.md': ['Nothing to see.'],
  },
  'flask-notes': {
    'app.py': [
      'from flask import Flask, request, redirect, send_from_directory, render_template_string',
      'from .storage import load_note, export_note, restore',
      'from .tools import thumbnail, thumbnail_safe',
      'app = Flask(__name__)',
      'ALLOWED_NEXT = {"/", "/notes"}',
      '',
      "@app.route('/notes/<name>')",
      '@login_required',
      'def note(name):',
      '    return load_note(name)',
      '',
      "@app.route('/notes/<name>/export')",
      '@login_required',
      'def export(name):',
      '    return export_note(request.args.get("fmt", "txt"), name)',
      '',
      "@app.route('/files')",
      'def files():',
      "    return send_from_directory('public', request.args.get('f'))",
      '',
      "@app.route('/restore', methods=['POST'])",
      '@login_required',
      'def do_restore():',
      '    return restore(request.data)',
      '',
      "@app.route('/thumb', methods=['POST'])",
      '@login_required',
      'def thumb():',
      "    thumbnail(request.form['path'])",
      "    thumbnail_safe(request.form['path'])",
      "    return 'ok'",
      '',
      "@app.route('/hello')",
      'def hello():',
      "!html     return render_template_string('<p>Hello ' + request.args.get('name', '') + '</p>')",
      '',
      "@app.route('/next')",
      'def nxt():',
      "    target = request.args.get('to', '/')",
      '    if target not in ALLOWED_NEXT:',
      "        target = '/'",
      '    return redirect(target)',
    ],
    'storage.py': [
      'import os, pickle',
      "BASE = '/srv/notes'",
      'def load_note(name):',
      '!path     with open(os.path.join(BASE, name)) as f:',
      '        return f.read()',
      'def export_note(fmt, name):',
      "    safe = os.path.basename(name)",
      "    with open(os.path.join(BASE, safe + '.' + fmt.replace('/', ''))) as f:",
      '        return f.read()',
      'def restore(blob):',
      '!deserialize     return pickle.loads(blob)',
    ],
    'tools.py': ['import subprocess', 'def thumbnail(p):', '!shell     subprocess.run(f"convert {p} -resize 64x64 out.png", shell=True)', 'def thumbnail_safe(p):', '    subprocess.run(["convert", p, "-resize", "64x64", "out.png"])'],
  },
  'go-svc': {
    'go.mod': ['module example.com/svc'],
    'main.go': [
      'package main',
      'import (',
      '  "net/http"',
      '  "example.com/svc/store"',
      ')',
      'func main() {',
      '  http.HandleFunc("/user", userHandler)',
      '  http.HandleFunc("/user2", user2Handler)',
      '  http.HandleFunc("/file", fileHandler)',
      '  http.HandleFunc("/go", func(w http.ResponseWriter, r *http.Request) {',
      '!redirect     http.Redirect(w, r, r.URL.Query().Get("u"), http.StatusFound)',
      '  })',
      '  http.HandleFunc("/home", func(w http.ResponseWriter, r *http.Request) {',
      '    http.Redirect(w, r, "/dash?tab="+r.URL.Query().Get("tab"), http.StatusFound)',
      '  })',
      '}',
      'func userHandler(w http.ResponseWriter, r *http.Request) {',
      '  store.Find(r.URL.Query().Get("id"))',
      '}',
      'func user2Handler(w http.ResponseWriter, r *http.Request) {',
      '  store.FindSafe(r.URL.Query().Get("id"))',
      '}',
      'func fileHandler(w http.ResponseWriter, r *http.Request) {',
      '  name := filepath.Base(r.URL.Query().Get("name"))',
      '  http.ServeFile(w, r, "/data/"+name)',
      '}',
    ],
    'store/store.go': ['package store', 'import "fmt"', 'func Find(id string) {', '  q := fmt.Sprintf("SELECT * FROM users WHERE id = \'%s\'", id)', '!sql   db.Query(q)', '}', 'func FindSafe(id string) {', '  db.Query("SELECT * FROM users WHERE id = $1", id)', '}'],
  },
  'koa-ws-cli': {
    'routes.js': [
      "const Router = require('koa-router');",
      "const convert = require('./convert');",
      'const router = new Router();',
      "router.post('/convert', requireLogin, async (ctx) => {",
      '  ctx.body = convert.run(ctx.request.body.file);',
      '});',
      "router.post('/convert2', requireLogin, async (ctx) => {",
      '  ctx.body = convert.runSafe(ctx.request.body.file);',
      '});',
    ],
    'convert.js': [
      "const { exec, execFile } = require('child_process');",
      'exports.run = (file) => {',
      "!shell   return exec('convert ' + file + ' out.png');",
      '};',
      'exports.runSafe = (file) => {',
      "  return execFile('convert', [file, 'out.png']);",
      '};',
    ],
    'ws.js': [
      "const vm = require('vm');",
      "const { handle } = require('./handle');",
      "wss.on('connection', (sock) => {",
      "  sock.on('message', (data) => handle(String(data)));",
      '});',
    ],
    'handle.js': ['const vm = require(\'vm\');', 'exports.handle = (text) => {', '  const msg = JSON.parse(text);', '!eval   return vm.runInNewContext(msg.code);', '};'],
    'bin/sync.js': ["const { execSync } = require('child_process');", 'const repo = process.argv[2];', "!shell execSync('git clone ' + repo);", "execSync('git status');"],
  },
};

const HELD_OUT: Record<string, Sample> = {
  'express-router': {
    'app.js': [
      "const express = require('express');",
      "const adminRouter = require('./routes/admin');",
      "const filesRouter = require('./routes/files');",
      "const { requireAdmin } = require('./auth');",
      'const app = express();',
      "app.use('/admin', requireAdmin, adminRouter);",
      "app.use('/files', filesRouter);",
    ],
    'routes/admin.js': ["const router = require('express').Router();", "const fs = require('fs');", "router.post('/purge', (req, res) => {", "  fs.rmSync('cache', { recursive: true });", '  res.end();', '});', 'module.exports = router;'],
    'routes/files.js': [
      "const router = require('express').Router();",
      "const fs = require('fs');",
      "const path = require('path');",
      "const DIR = path.join(__dirname, '..', 'files');",
      "router.get('/raw', (req, res) => {",
      '  const opts = { file: req.query.f };',
      '  stream(opts, res);',
      '});',
      "router.get('/later', (req, res) => {",
      '  lookupName(req, (name) => {',
      "!path     fs.readFile(path.join(DIR, name), (e, b) => res.end(b));",
      '  });',
      '});',
      "router.get('/page', (req, res) => res.render('page', { html: req.query.x }));",
      'function stream(o, res) {',
      '!path   fs.createReadStream(path.join(DIR, o.file)).pipe(res);',
      '}',
      'function lookupName(req, cb) {',
      '  cb(req.query.name);',
      '}',
      'module.exports = router;',
    ],
  },
  'fastify-shop': {
    'app.js': [
      "const fastify = require('fastify')();",
      "const catalog = require('./catalog');",
      "fastify.get('/img', async (request, reply) => reply.send(catalog.image(request.query.file)));",
      "fastify.get('/search', async (request, reply) => catalog.search(request.query.q));",
      "fastify.get('/item', async (request, reply) => catalog.item(request.query.id));",
      "fastify.get('/hook', async (request, reply) => catalog.ping(request.query.callback));",
    ],
    'catalog.js': [
      "const fs = require('fs/promises');",
      "const path = require('path');",
      'exports.image = (file) => {',
      "!path   return fs.readFile(path.join(__dirname, 'img', file));",
      '};',
      'exports.search = (q) => {',
      "!sql   return db.all('SELECT * FROM items WHERE name LIKE \"%' + q + '%\"');",
      '};',
      'exports.item = (id) => {',
      "  return db.all('SELECT * FROM items WHERE id = ?', [Number(id)]);",
      '};',
      'exports.ping = async (callback) => {',
      '  const u = new URL(callback);',
      "  if (!['hooks.example.com'].includes(u.hostname)) throw new Error('not allowed');",
      '  return fetch(u);',
      '};',
    ],
  },
  'fastapi-files': {
    'main.py': [
      'from fastapi import FastAPI, Depends',
      'from .service import read_report, convert, convert_ok, lookup',
      'app = FastAPI()',
      "@app.get('/report')",
      'def report(name: str):',
      '    return read_report(name)',
      "@app.post('/convert')",
      'def do_convert(src: str, user=Depends(get_current_user)):',
      '    convert(src)',
      '    convert_ok(src)',
      "    return {'ok': True}",
      "@app.get('/lookup')",
      'def do_lookup(url: str):',
      '    return lookup(url)',
      "@app.get('/config')",
      'def config():',
      "!secret     return {'key': os.environ['STRIPE_SECRET_KEY']}",
    ],
    'service.py': [
      'import os, subprocess, httpx',
      "REPORTS = '/srv/reports'",
      'def read_report(name):',
      "!path     return open(REPORTS + '/' + name).read()",
      'def convert(src):',
      '!shell     os.system("pandoc " + src + " -o out.pdf")',
      'def convert_ok(src):',
      '    subprocess.run(["pandoc", src, "-o", "out.pdf"], check=True)',
      'def lookup(url):',
      '!ssrf     return httpx.get(url).text',
    ],
  },
  'django-blog': {
    'blog/views.py': [
      'from django.http import HttpResponse, HttpResponseRedirect',
      'from django.contrib.auth.decorators import login_required',
      'from .queries import posts_by_tag, post_by_id',
      'def tag(request, tag):',
      '    return HttpResponse(posts_by_tag(tag))',
      'def post(request, pk):',
      '    return HttpResponse(post_by_id(pk))',
      'def leave(request):',
      "!redirect     return HttpResponseRedirect(request.GET.get('next'))",
      'def leave_ok(request):',
      "    nxt = request.GET.get('next', '/')",
      "    if not url_has_allowed_host_and_scheme(nxt, allowed_hosts=None):",
      "        nxt = '/'",
      '    return HttpResponseRedirect(nxt)',
    ],
    'blog/queries.py': [
      'from django.db import connection',
      'def posts_by_tag(tag):',
      '    with connection.cursor() as c:',
      '!sql         c.execute("SELECT title FROM posts WHERE tag = \'{}\'".format(tag))',
      '        return c.fetchall()',
      'def post_by_id(pk):',
      '    with connection.cursor() as c:',
      '        c.execute("SELECT title FROM posts WHERE id = %s", [pk])',
      '        return c.fetchone()',
    ],
  },
  'node-http-gin': {
    'server.js': [
      "const http = require('http');",
      "const { render } = require('./render');",
      'http.createServer((req, res) => {',
      "  const u = new URL(req.url, 'http://localhost');",
      "  res.end(render(u.searchParams.get('name')));",
      '}).listen(8080);',
    ],
    'render.js': ["exports.render = (name) => {", "!html   return res.end('<h1>Hello ' + name + '</h1>');", '};'],
    'go.mod': ['module example.com/api'],
    'api.go': [
      'package main',
      'import "os/exec"',
      'func routes(r *gin.Engine) {',
      '  r.GET("/ping", func(c *gin.Context) {',
      '!shell     exec.Command("sh", "-c", "ping -c1 "+c.Query("host")).Run()',
      '  })',
      '  r.GET("/ping2", func(c *gin.Context) {',
      '    exec.Command("ping", "-c1", c.Query("host")).Run()',
      '  })',
      '}',
    ],
  },
};

export interface EvalResult {
  set: string;
  precision: number;
  recall: number;
  tp: number;
  fp: number;
  fn: number;
  perKind: Record<string, { tp: number; fp: number; fn: number }>;
  misses: string[];
  falseAlarms: string[];
}

export function runEval(set: 'tuning' | 'held-out'): EvalResult {
  const samples = set === 'tuning' ? TUNING : HELD_OUT;
  const perKind: EvalResult['perKind'] = Object.fromEntries(THREAT_KINDS.map((k) => [k, { tp: 0, fp: 0, fn: 0 }]));
  const misses: string[] = [];
  const falseAlarms: string[] = [];
  for (const [name, sample] of Object.entries(samples)) {
    const files: Record<string, string> = {};
    const expected = new Set<string>();
    for (const [file, lines] of Object.entries(sample)) {
      files[file] = lines
        .map((l, i) => {
          const m = /^!(\w+) (.*)$/.exec(l);
          if (!m) return l;
          expected.add(`${m[1]}|${file}|${i + 1}`);
          return m[2];
        })
        .join('\n');
    }
    const found = new Set(analyze(Object.keys(files), (f) => files[f]).hits.map((h) => `${h.kind}|${h.sink.file}|${h.sink.line}`));
    for (const k of found) {
      const kind = k.split('|')[0] as ThreatKind;
      if (expected.has(k)) perKind[kind].tp++;
      else {
        perKind[kind].fp++;
        falseAlarms.push(`${name}: ${k}`);
      }
    }
    for (const k of expected) {
      if (found.has(k)) continue;
      perKind[k.split('|')[0]].fn++;
      misses.push(`${name}: ${k}`);
    }
  }
  const tp = Object.values(perKind).reduce((n, x) => n + x.tp, 0);
  const fp = Object.values(perKind).reduce((n, x) => n + x.fp, 0);
  const fn = Object.values(perKind).reduce((n, x) => n + x.fn, 0);
  return { set, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1, tp, fp, fn, perKind, misses, falseAlarms };
}

if (import.meta.main) {
  const results = [runEval('tuning'), runEval('held-out')];
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else {
    for (const r of results) {
      console.log(`${r.set}: precision ${(r.precision * 100).toFixed(1)} % · recall ${(r.recall * 100).toFixed(1)} % (tp ${r.tp}, fp ${r.fp}, fn ${r.fn})`);
      for (const [k, v] of Object.entries(r.perKind)) if (v.tp + v.fp + v.fn) console.log(`  ${k.padEnd(12)} tp ${v.tp} fp ${v.fp} fn ${v.fn}`);
      for (const m of r.misses) console.log(`  missed: ${m}`);
      for (const m of r.falseAlarms) console.log(`  false alarm: ${m}`);
    }
    const dir = join(ROOT, 'evals', 'results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}-threat.json`), JSON.stringify(results, null, 2));
  }
  const t = results[0];
  if (t.precision < 0.9 || t.recall < 0.85) process.exitCode = 1;
}
