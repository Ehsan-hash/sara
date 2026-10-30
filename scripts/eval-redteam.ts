// Phase 86 (harness track M11): the offline eval of red-team mode's code path (src/redteam.ts,
// src/redteam-probes.ts). No model, no network beyond 127.0.0.1: each seeded-broken project is
// really run in an M5 sandbox copy (copy-only on a PC without an OS sandbox), the app is started on
// a free port in SARA_REDTEAM_PORTS (default 7890-7899), the fixed catalogue of generic inputs is
// sent to every entry point M7 finds, the insecure-default checks run, and every break must happen
// again in a fresh copy to count. Scored on labels written with the projects:
//   a probe break counts as (entry, kind)   e.g. "GET /sum crash"
//   an insecure default counts as its rule e.g. "default:listen-all"
// Precision: were the reported breaks real? Recall: were the seeded ones found? Each seeded break
// has a guarded near-miss twin next to it (the twins must stay quiet).
//
// Two sets: "tuning" (the detectors were tuned on it) and "held-out" (written after the tuning,
// other server shapes, not used to change the code).
//
//   node scripts/eval-redteam.ts          print the table, write evals/results/<date>-redteam.json
//   node scripts/eval-redteam.ts --json   the same as JSON on stdout
//
// Exit code 1 if the tuning set is under precision 0.9 / recall 0.85.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RedTeam } from '../src/redteam.ts';
import { RunStore } from '../src/runs.ts';
import { SandboxGate, sandboxGateSettings } from '../src/sandbox-run.ts';
import { FindingStore } from '../src/security/findings.ts';
import { makeApp, tempDir } from '../test/helpers.ts';
import { EXPRESS_BREAKS, expressProject, PY_BREAKS, pythonProject, ROUTER, writeFiles } from '../test/redteam-fixtures.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PY = ['python3', 'python'].find((p) => spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0);
const PORTS: [number, number] = (() => {
  const m = /^(\d+)-(\d+)$/.exec(process.env.SARA_REDTEAM_PORTS ?? '');
  return m ? [Number(m[1]), Number(m[2])] : [7890, 7899];
})();

interface Project {
  write: (dir: string) => void;
  /** Labels: "<entry> <kind>" for probe breaks, "default:<rule>" for insecure defaults. */
  expected: string[];
  python?: boolean;
}

const labels = (m: Record<string, string[]>) => Object.entries(m).flatMap(([e, ks]) => ks.map((k) => `${e} ${k}`));

// ---- held-out projects (written after the tuning) ------------------------------------------------

const NODE_HTTP = `const http = require('http');
const notes = ['milk', 'eggs', 'bread'];
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/page') {
    const size = Number(u.searchParams.get('size'));
    const list = new Array(size).fill('n');
    res.end(JSON.stringify(list.slice(0, 3)));
    return;
  }
  if (u.pathname === '/safe-page') {
    const size = Math.min(50, Math.max(0, Math.floor(Number(u.searchParams.get('size')) || 0)));
    res.end(JSON.stringify(new Array(size).fill('n').slice(0, 3)));
    return;
  }
  if (u.pathname === '/item') {
    const i = u.searchParams.get('i');
    res.end(notes[i].toUpperCase());
    return;
  }
  if (u.pathname === '/safe-item') {
    const note = notes[Number(u.searchParams.get('i'))];
    if (typeof note !== 'string') { res.writeHead(404); res.end('no such note'); return; }
    res.end(note.toUpperCase());
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(process.env.PORT || 3000, '0.0.0.0');
`;

const PY_CALC = `import json
import os
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


class Calc(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == '/half':
            try:
                n = int(q['n'][0])
                self.reply(200, str(n // 2))
            except Exception:
                self.reply(400, traceback.format_exc())
        elif u.path == '/safe-half':
            try:
                n = int(q['n'][0])
                self.reply(200, str(n // 2))
            except Exception:
                self.reply(400, 'n must be a whole number')
        elif u.path == '/stars':
            n = int(q.get('n', ['1'])[0])
            self.reply(200, ('*' * n)[:20])
        elif u.path == '/safe-stars':
            raw = q.get('n', ['1'])[0]
            n = int(raw) if raw.isdigit() and len(raw) < 4 else 1
            self.reply(200, ('*' * n)[:20])
        else:
            self.reply(404, 'not found')

    def reply(self, code, text):
        data = text.encode('utf-8')
        self.send_response(code)
        self.send_header('content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


port = int(os.environ.get('PORT', '8000'))
HTTPServer(('127.0.0.1', port), Calc).serve_forever()
`;

const USERS = `const express = require('./lib/router');
const app = express();
const ADMIN_PASSWORD = 'admin';
const users = [];
app.get('/', (req, res) => res.send('ok'));
app.post('/users', (req, res) => {
  const name = req.body.name.trim();
  users.push(name);
  res.status(201).json({ name });
});
app.post('/safe-users', (req, res) => {
  if (typeof req.body.name !== 'string' || !req.body.name.trim()) return res.status(400).send('name?');
  res.status(201).json({ name: req.body.name.trim() });
});
app.get('/find', (req, res) => {
  const rows = new Array(Number(req.query.limit)).fill(null);
  res.json({ rows: rows.length });
});
app.get('/safe-find', (req, res) => {
  const limit = Math.min(100, Math.max(0, Math.floor(Number(req.query.limit)) || 0));
  res.json({ rows: limit });
});
app.listen(process.env.PORT || 3000, () => console.log('listening'));
`;

const SETS: Record<'tuning' | 'held-out', Record<string, Project>> = {
  tuning: {
    'express-shop': { write: (d) => expressProject(d), expected: [...labels(EXPRESS_BREAKS), 'default:env-committed', 'default:missing-headers'] },
    'python-age': { write: (d) => pythonProject(d), expected: labels(PY_BREAKS), python: true },
  },
  'held-out': {
    'node-http-notes': {
      write: (d) => writeFiles(d, { 'package.json': JSON.stringify({ name: 'notes', private: true, scripts: { start: 'node server.js' } }, null, 2), 'server.js': NODE_HTTP }),
      expected: ['GET /page exit', 'GET /item exit', 'default:cors-wildcard', 'default:listen-all', 'default:missing-headers'],
    },
    'python-calc': {
      write: (d) => writeFiles(d, { 'calc.py': PY_CALC, 'config.json': '{ "debug": true, "name": "calc" }\n' }),
      expected: ['GET /half stack-trace', 'GET /stars uncaught', 'default:debug-on', 'default:missing-headers'],
      python: true,
    },
    'express-users': {
      write: (d) => writeFiles(d, { 'package.json': JSON.stringify({ name: 'users', private: true, scripts: { start: 'node server.js' } }, null, 2), 'lib/router.js': ROUTER, 'server.js': USERS }),
      expected: ['POST /users crash', 'GET /find crash', 'default:default-credentials', 'default:missing-headers'],
    },
  },
};

async function runProject(name: string, p: Project) {
  const { dir, cleanup } = tempDir();
  const app = makeApp(dir, { now: new Date() });
  try {
    app.runs = new RunStore(app.store.db, app.now);
    app.findings = new FindingStore(app.store.db, app.now);
    app.sandboxGate = new SandboxGate(join(dir, 'cache', 'sandbox-runs'), app.sandbox, () => sandboxGateSettings(app.settings.get()));
    app.redteam = new RedTeam(app, app.findings, app.store.db);
    app.settings.update({ redteam: { ship: 'ask', scripts: 0, budgetTokens: 10_000, minutes: 5 }, securityPass: { mode: 'off', reviewer: false, advisories: false, budgetTokens: 30_000, runTests: true } } as never);
    const ws = join(dir, 'workspaces', name);
    mkdirSync(ws, { recursive: true });
    p.write(ws);
    const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', ...a], { cwd: ws });
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'init');
    const t0 = Date.now();
    const r = app.redteam.start({ workspace: name, wsDir: ws, ports: PORTS });
    const done = (await app.redteam.running.get(r.id)!.promise)!;
    const found = done.breaks.map((b) => (b.by === 'default' ? `default:${b.kind}` : `${b.entry} ${b.kind}`));
    return { status: done.status, error: done.error, started: done.app?.started ?? false, why: done.app?.why ?? null, probes: done.tried.probes, ms: Date.now() - t0, isolation: done.isolation.label, found: [...new Set(found)].sort() };
  } finally {
    app.store.close();
    cleanup();
  }
}

const out: Record<string, unknown> = { date: new Date().toISOString(), ports: PORTS, sets: {} };
const rows: string[] = [];
let failBar = false;
for (const [set, projects] of Object.entries(SETS)) {
  let exp = 0;
  let got = 0;
  let ok = 0;
  const per: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(projects)) {
    if (p.python && !PY) {
      per[name] = { skipped: 'no Python on this computer' };
      continue;
    }
    const r = await runProject(name, p);
    const hit = r.found.filter((f) => p.expected.includes(f));
    const extra = r.found.filter((f) => !p.expected.includes(f));
    const missed = p.expected.filter((e) => !r.found.includes(e));
    exp += p.expected.length;
    got += r.found.length;
    ok += hit.length;
    per[name] = { ...r, expected: p.expected, hit, extra, missed };
  }
  const precision = got ? ok / got : 1;
  const recall = exp ? ok / exp : 1;
  (out.sets as Record<string, unknown>)[set] = { projects: per, expected: exp, found: got, correct: ok, precision, recall };
  rows.push(`| ${set} | ${Object.keys(projects).length} | ${exp} | ${got} | ${ok} | ${(precision * 100).toFixed(1)} % | ${(recall * 100).toFixed(1)} % |`);
  if (set === 'tuning' && (precision < 0.9 || recall < 0.85)) failBar = true;
}

if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  console.log('| Set | Projects | Expected | Found | Correct | Precision | Recall |\n|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
  for (const [set, s] of Object.entries(out.sets as Record<string, { projects: Record<string, { missed?: string[]; extra?: string[]; skipped?: string; probes?: number; ms?: number; why?: string | null }> }>)) {
    for (const [name, p] of Object.entries(s.projects)) console.log(`${set} / ${name}: ${p.skipped ?? `${p.probes} inputs, ${Math.round((p.ms ?? 0) / 1000)} s; missed ${JSON.stringify(p.missed)}; extra ${JSON.stringify(p.extra)}${p.why ? `; app: ${p.why}` : ''}`}`);
  }
  const resDir = join(ROOT, 'evals', 'results');
  mkdirSync(resDir, { recursive: true });
  writeFileSync(join(resDir, `${new Date().toISOString().slice(0, 10)}-redteam.json`), JSON.stringify(out, null, 2));
}
process.exit(failBar ? 1 : 0);
