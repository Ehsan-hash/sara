// Phase 40 exit check on REAL models and REAL GitHub: an issue goes to a reviewed pull request on a
// test repository with no hand edits. Sara notices the issue (watching the repository), clones it
// into its own workspace, her team plans, builds, tests and reviews, and she commits to a branch,
// pushes, opens the pull request (closing the issue) and posts her review on it. Checked here
// independently through the GitHub API and by running the tests in the clone.
//   GH_TOKEN=… node scripts/eval-workflow.ts --repo farena-ai/sara-workflow-test --issue 1
//        [--ollama http://127.0.0.1:11434/v1] [--chat gemma4:31b-cloud] [--coding kimi-k2.7-code:cloud]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { AppContext } from '../src/chat.ts';
import { createReviewTools } from '../src/codereview.ts';
import { EventHub } from '../src/events.ts';
import { checkIssues, openIssues, startFromIssue } from '../src/issues.ts';
import { MemoryStore } from '../src/memory.ts';
import { loadPersona } from '../src/persona.ts';
import { PlannerStore } from '../src/planner.ts';
import { ProjectKnowledgeStore } from '../src/projectknow.ts';
import { Redactor } from '../src/redact.ts';
import { SettingsStore } from '../src/settings.ts';
import { SnapshotStore } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { TeamManager, teamHelpers } from '../src/team.ts';
import { editFileTool, listDir, readFileTool, searchTool, shellTool, writeFileTool } from '../src/tools/builtin.ts';
import { createCodingTools } from '../src/tools/coding.ts';
import { createGitHubTools } from '../src/tools/github.ts';
import { ApprovalBroker, ToolRegistry } from '../src/tools/registry.ts';
import { workspaceDir } from '../src/tools/workspace.ts';
import { Vault } from '../src/vault.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { repo: { type: 'string', default: 'farena-ai/sara-workflow-test' }, issue: { type: 'string', default: '1' }, ollama: { type: 'string', default: 'http://127.0.0.1:11434/v1' }, chat: { type: 'string', default: 'gemma4:31b-cloud' }, coding: { type: 'string', default: 'kimi-k2.7-code:cloud' } } });
const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN needed');
const repo = opt.repo!;
const issueNo = Number(opt.issue);

const dataDir = mkdtempSync(join(tmpdir(), 'sara-workflow-'));
const vault = new Vault(dataDir);
const store = new Store(join(dataDir, 'sara.db'));
const app: AppContext = { store, settings: new SettingsStore(dataDir), vault, persona: loadPersona(join(ROOT, 'persona', 'sara.json')), now: () => new Date(), dataDir, tools: new ToolRegistry(), approvals: new ApprovalBroker(), sandbox: { mode: 'none', network: true, detail: 'eval' }, redactor: new Redactor(() => vault.values()), snapshots: new SnapshotStore(dataDir), memory: new MemoryStore(store.db), events: new EventHub() };
app.planner = new PlannerStore(store.db);
vault.set('git:github', token);
for (const t of [listDir, readFileTool, writeFileTool, editFileTool, searchTool, shellTool]) app.tools.add(t);
for (const t of createCodingTools(app)) app.tools.add(t);
for (const t of createGitHubTools(app)) app.tools.add(t);
for (const t of createReviewTools(() => app)) app.tools.add(t);
app.team = new TeamManager(app, store.db);
app.projects = new ProjectKnowledgeStore(app, store.db);
app.settings.update({
  providers: [{ id: 'ol', label: 'Ollama', kind: 'openai-compatible', baseUrl: opt.ollama!, local: true }],
  defaultProviderId: 'ol',
  defaultModel: opt.chat,
  routes: { coding: { providerId: 'ol', model: opt.coding! } },
  ownerName: 'Alex',
  timeZone: 'America/Chicago',
  // The owner's answers are given up front for this run: checkpoints off, tools allowed.
  toolPermissions: { shell: 'auto', write_file: 'auto', edit_file: 'auto', git_commit: 'auto', git_push: 'auto', github_open_pr: 'auto' },
  githubWatch: { repos: [repo], label: 'sara', everyMinutes: 15, seen: { [repo]: issueNo - 1 } },
});

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};
const gh = async <T>(path: string): Promise<T> => {
  const r = await fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'sara-eval' } });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return (await r.json()) as T;
};

// 1. She notices the issue (the watcher's check) and it lands on the planner.
const fresh = await checkIssues(app);
check(fresh.some((i) => i.number === issueNo), `the watcher found ${repo}#${issueNo} (${fresh.map((i) => `#${i.number}`).join(', ') || 'nothing'})`);
check(app.planner.tasks({ status: 'all' }).some((t) => t.title.startsWith(`GitHub ${repo}#${issueNo}:`)), 'it is on the planner');
check((await openIssues(app)).some((i) => i.number === issueNo), 'it shows in the Team page list');

// 2. The team works it through, with no hand edits.
const t0 = Date.now();
const task = await startFromIssue(app, repo, issueNo, { checkpoints: false, pr: true });
console.log(`team task #${task.id} in workspace ${store.getConversation(task.conversationId)!.workspace}`);
const done = await app.team.finished(task.id);
const names = new Map(teamHelpers(app).map((h) => [h.id, h.name]));
names.set('lead', 'Sara');
console.log(`${done.status} in ${Math.round((Date.now() - t0) / 1000)} s, about ${done.tokens.toLocaleString('en-US')} tokens`);
for (const s of done.steps) console.log(`  ${s.idx + 1}. ${names.get(s.helper) ?? s.helper}: ${s.title} [${s.status}]${s.because ? ` (${s.because})` : ''}\n     ${s.receipts.map((r) => `${r.name}${r.name === 'shell' ? ` \`${String(r.args.command).slice(0, 50)}\` → ${/^\[(exit code \w+)/.exec(r.output)?.[1] ?? r.status}` : r.args.path ? ` ${r.args.path}` : ''}:${r.status}`).join('; ') || '(no tools)'}`);
const msg = store.messages(task.conversationId).filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
console.log(`her report:\n${msg.split('\n').map((l) => `  | ${l}`).join('\n')}`);
check(done.status === 'done', `finished (status ${done.status})`);
const prUrl = done.workflow?.prUrl;
check(Boolean(prUrl), `a pull request was opened: ${prUrl ?? 'none'}`);

// 3. Independent checks on GitHub and in the clone.
if (prUrl) {
  const n = Number(prUrl.split('/').pop());
  const pr = await gh<{ state: string; body: string; head: { ref: string }; base: { ref: string }; user: { login: string } }>(`/repos/${repo}/pulls/${n}`);
  check(pr.state === 'open' && pr.head.ref.startsWith('sara/') && pr.base.ref === 'main', `PR #${n} is open from ${pr.head.ref} into ${pr.base.ref}`);
  check(new RegExp(`Closes #${issueNo}\\b`).test(pr.body ?? ''), 'the PR closes the issue');
  const files = await gh<{ filename: string; status: string }[]>(`/repos/${repo}/pulls/${n}/files`);
  check(files.some((f) => f.filename === 'price.js') && files.some((f) => /test/.test(f.filename)), `it changes the code and the tests (${files.map((f) => f.filename).join(', ')})`);
  check(files.every((f) => !/(^|\/)(npm-cache|\.npm|\.cache|\.local)\//.test(f.filename) && !/^\.(gitconfig|sara-task)/.test(f.filename)), 'no stray files from the workspace (caches, the app\'s own files)');
  const reviews = await gh<{ body: string; state: string; user: { login: string } }[]>(`/repos/${repo}/pulls/${n}/reviews`);
  const comments = await gh<unknown[]>(`/repos/${repo}/pulls/${n}/comments`);
  check(reviews.some((r) => /Review by Sara/.test(r.body ?? '')), `her review is posted on the PR (${reviews.length} review(s), ${comments.length} line comment(s))`);
  const tested = done.steps.filter((s) => names.get(s.helper) === 'Tester' && s.status === 'done').at(-1);
  const lastRun = tested?.receipts.filter((r) => r.name === 'shell').at(-1);
  check(Boolean(lastRun && /^\[exit code 0/.test(lastRun.output)), 'the tester\'s last run passed');
  const ws = workspaceDir(dataDir, store.getConversation(task.conversationId)!.workspace);
  let pass = false;
  try {
    execFileSync(process.execPath, ['--test'], { cwd: ws, stdio: 'pipe', timeout: 60_000 });
    pass = true;
  } catch {
    pass = false;
  }
  check(pass, '`node --test` passes on the branch when run independently');
  check(/• Sara opened https:\/\/github\.com\/.+\/pull\/\d+/.test(msg) && /• Sara posted the review/.test(msg), 'her report lists the pull request and the review from the receipts');
}
store.close();
rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
console.log(fails ? `\n${fails} FAILED` : '\nPASS');
process.exit(fails ? 1 : 0);
