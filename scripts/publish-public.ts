// Publishes a release to the PUBLIC repository (github.com/farena-ai/sara), which has its own clean
// history: development happens in a private repository, and each release's public copy (made and
// checked by scripts/public-export.ts) becomes one commit + tag there. Nothing is pushed unless
// --push is given; without it the commit is made locally in outputs/public-repo for a look.
//   node scripts/publish-public.ts [--push] [--repo farena-ai/sara]
// Author identity: the GitHub no-reply address in SARA_PUBLIC_EMAIL (e.g.
// 12345+name@users.noreply.github.com) and SARA_PUBLIC_NAME; a personal address is refused.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({ options: { push: { type: 'boolean', default: false }, repo: { type: 'string', default: 'farena-ai/sara' } } });
const name = process.env.SARA_PUBLIC_NAME?.trim();
const email = process.env.SARA_PUBLIC_EMAIL?.trim();
if (!name || !email) throw new Error('Set SARA_PUBLIC_NAME and SARA_PUBLIC_EMAIL (a GitHub no-reply address).');
if (!/@users\.noreply\.github\.com$/i.test(email)) throw new Error('SARA_PUBLIC_EMAIL must be a GitHub no-reply address, so no personal email goes public.');

const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const tag = `v${version}`;
const run = (cmd: string, args: string[], cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const git = (args: string[], cwd: string) => run('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false', ...args], cwd);

// 1. A fresh, checked public copy (fails on any secret or private detail).
run(process.execPath, [join(ROOT, 'scripts', 'public-export.ts')]);
const exportDir = join(ROOT, 'outputs', 'public-export');

// 2. The public repository, cloned (or created empty) under outputs/.
const repoDir = join(ROOT, 'outputs', 'public-repo');
// A leftover clone of another repository (or an older state) is thrown away and cloned fresh.
if (existsSync(join(repoDir, '.git'))) rmSync(repoDir, { recursive: true, force: true });
if (!existsSync(join(repoDir, '.git'))) {
  rmSync(repoDir, { recursive: true, force: true });
  try {
    run('git', ['clone', '--quiet', `https://github.com/${opt.repo}.git`, repoDir]);
  } catch {
    run('git', ['init', '--quiet', '-b', 'main', repoDir]);
    run('git', ['remote', 'add', 'origin', `https://github.com/${opt.repo}.git`], repoDir);
  }
}
// Guard: never publish into the private development history. The public repository starts from
// a root commit made by this script; merged outside pull requests (other authors) are fine on top
// of it, but no commit of the private repository may be in it.
const privateRoots = run('git', ['rev-list', '--max-parents=0', 'HEAD'], ROOT).split('\n').filter(Boolean);
let publicRoots: string[] = [];
try {
  publicRoots = run('git', ['rev-list', '--max-parents=0', 'HEAD'], repoDir).split('\n').filter(Boolean);
} catch {
  publicRoots = []; // no commits yet
}
const hasPrivate = privateRoots.some((sha) => {
  try {
    run('git', ['cat-file', '-e', `${sha}^{commit}`], repoDir);
    return true;
  } catch {
    return false;
  }
});
const rootAuthors = publicRoots.map((sha) => run('git', ['log', '-1', '--format=%ae', sha], repoDir));
if (hasPrivate || rootAuthors.some((a) => a !== email)) throw new Error(`github.com/${opt.repo} is not the clean public repository (it holds private history or a root commit from another identity). Nothing was changed.`);
if (run('git', ['tag', '--list', tag], repoDir)) throw new Error(`${tag} is already in the public repository.`);

// 3. Replace its files with the public copy (its .git stays), commit and tag.
for (const f of readdirSync(repoDir)) if (f !== '.git') rmSync(join(repoDir, f), { recursive: true, force: true });
for (const f of readdirSync(exportDir)) cpSync(join(exportDir, f), join(repoDir, f), { recursive: true });
git(['add', '-A'], repoDir);
// Copying on Windows drops the executable bit: carry it over from the private repository's index
// (install scripts, the `sara` command, gradlew…), or installs on Linux and macOS break.
const executables = run('git', ['ls-files', '-s'], ROOT)
  .split('\n')
  .filter((l) => l.startsWith('100755 '))
  .map((l) => l.split('\t')[1]!)
  .filter((p) => existsSync(join(repoDir, p)));
if (executables.length) run('git', ['update-index', '--chmod=+x', '--', ...executables], repoDir);
let first = false;
try {
  run('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], repoDir);
} catch {
  first = true; // an empty repository: this is its first commit
}
if (!first && !run('git', ['status', '--porcelain'], repoDir)) throw new Error('Nothing changed since the last public release.');
// Outside contributors whose pull requests went into this release get a Co-authored-by trailer, so
// GitHub credits them: SARA_PUBLIC_COAUTHORS="Name <id+login@users.noreply.github.com>; …".
const coauthors = (process.env.SARA_PUBLIC_COAUTHORS ?? '').split(';').map((s) => s.trim()).filter((s) => /^[^<>\n]+ <[^<>\s@]+@[^<>\s]+>$/.test(s));
const trailers = coauthors.length ? `\n\n${coauthors.map((c) => `Co-authored-by: ${c}`).join('\n')}` : '';
git(['commit', '--quiet', '-m', first ? `Sara ${version}` : `Sara ${version}\n\nSee CHANGELOG.md.${trailers}`], repoDir);
git(['tag', '-a', tag, '-m', `Sara ${version}`], repoDir);

// 4. A last look at what this commit carries: author and committer must be the no-reply identity.
const ids = run('git', ['log', '-1', '--format=%an <%ae>%n%cn <%ce>'], repoDir);
if (ids.split('\n').some((l) => !l.includes(email))) throw new Error(`Unexpected identity in the commit:\n${ids}`);
console.log(`Committed ${tag} in ${repoDir} as ${name} <${email}>.`);
if (opt.push) {
  run('git', ['push', '--quiet', 'origin', 'HEAD:main'], repoDir);
  run('git', ['push', '--quiet', 'origin', tag], repoDir);
  console.log(`Pushed main and ${tag} to github.com/${opt.repo}.`);
} else console.log('Not pushed (add --push).');
