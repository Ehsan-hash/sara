// Phase 46d: checks the macOS seatbelt sandbox for real, on a Mac:
//   node scripts/verify-seatbelt-mac.ts [scratch-folder]
// Makes a fake data folder (with a space in its path, like "Application Support") and runs commands
// through detectSandbox() + runCommand() exactly as her shell tool does. Every line must say PASS.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSandbox, runCommand } from '../src/tools/sandbox.ts';

if (process.platform !== 'darwin') throw new Error('Run this on a Mac.');
const base = process.argv[2] ?? join(mkdtempSync(join(tmpdir(), 'sara-seatbelt-')), 'App Support');
const data = join(base, 'data');
const ws = join(data, 'workspaces', 'main');
rmSync(data, { recursive: true, force: true });
mkdirSync(ws, { recursive: true });
writeFileSync(join(data, 'secret.txt'), 'DATA-SECRET');
const home = homedir();
const desk = join(home, 'Desktop', 'sara-sbx-test.txt');
const tmpOut = '/tmp/sara-sbx-test.txt';
const la = join(home, 'Library', 'LaunchAgents', 'sara-sbx-test.plist');
for (const f of [desk, tmpOut, la]) rmSync(f, { force: true });

const results: { check: string; expect: string; ok: boolean; out: string }[] = [];
async function check(name: string, cmd: string, network: boolean, expectOk: boolean, extra?: () => boolean) {
  const sb = detectSandbox('auto', network, { dataDir: data });
  if (sb.mode !== 'seatbelt') throw new Error('not seatbelt: ' + sb.detail);
  const r = await runCommand(cmd, ws, sb, { timeoutMs: 60_000, signal: new AbortController().signal });
  let ok = (r.exitCode === 0) === expectOk;
  if (extra) ok = ok && extra();
  results.push({ check: name, expect: expectOk ? 'allowed' : 'denied', ok, out: `exit=${r.exitCode} ${r.output.trim().replace(/\s+/g, ' ').slice(0, 160)}` });
}

await check('write inside workspace', 'echo hi > ok.txt && cat ok.txt', false, true, () => existsSync(join(ws, 'ok.txt')));
await check('write in own run temp ($TMPDIR)', 'echo t > "$TMPDIR/x" && cat "$TMPDIR/x"', false, true);
await check('write to ~/Desktop', `echo x > ${JSON.stringify(desk)}`, false, false, () => !existsSync(desk));
await check('write to /tmp (outside run temp)', `echo x > ${tmpOut}`, false, false, () => !existsSync(tmpOut));
await check('write to ~/Library/LaunchAgents', `echo x > ${JSON.stringify(la)}`, false, false, () => !existsSync(la));
await check('write to the data folder (outside workspace)', `echo x > ${JSON.stringify(join(data, 'evil.txt'))}`, false, false, () => !existsSync(join(data, 'evil.txt')));
await check('read SARA_DATA file', `cat ${JSON.stringify(join(data, 'secret.txt'))}`, false, false);
await check('list SARA_DATA', `ls ${JSON.stringify(data)}`, false, false);
await check('read via ../ from workspace', 'cat ../../secret.txt', false, false);
await check('read ~/Documents (home folder hidden)', `ls ${JSON.stringify(join(home, 'Documents'))}`, false, false);
await check('list the home folder', `ls ${JSON.stringify(home)}`, false, false);
await check('list ~/.ssh', `ls ${JSON.stringify(join(home, '.ssh'))}`, false, false);
const sshDir = join(home, '.ssh');
const sshFile = existsSync(sshDir) ? readdirSync(sshDir).map((n) => join(sshDir, n)).find((f) => statSync(f).isFile()) : undefined;
if (sshFile) await check(`read a file in ~/.ssh (${sshFile.split('/').pop()})`, `head -c 20 ${JSON.stringify(sshFile)} >/dev/null`, false, false);
await check('read the login keychain file', `head -c 4 ${JSON.stringify(join(home, 'Library', 'Keychains', 'login.keychain-db'))} >/dev/null`, false, false);
await check('which git (real binary, not the xcrun shim)', 'command -v git; git --version 2>&1 | grep -v "cache file"', false, true);
await check('list ~/Library/Keychains', `ls ${JSON.stringify(join(home, 'Library', 'Keychains'))}`, false, false);
await check('read /usr/bin', 'ls /usr/bin | head -3 && cat /etc/hosts | head -1', false, true);
await check('network off: curl blocked', 'curl -sS -m 15 -o /dev/null -w "%{http_code}" https://example.com', false, false);
await check('network on: curl works', 'curl -sS -m 15 -o /dev/null -w "%{http_code}" https://example.com', true, true);
await check('node in workspace', 'node -e "require(\'fs\').writeFileSync(\'n.txt\', process.version); console.log(process.version)" && cat n.txt', false, true);
await check('npm in workspace', 'npm init -y >/dev/null && npm -v && test -f package.json', false, true);
await check('git in workspace', 'git init -q r && cd r && echo a > a && git add a && git commit -qm one && git log --oneline | wc -l', false, true);
await check('symlink to secret then read', `ln -s ${JSON.stringify(join(data, 'secret.txt'))} link && cat link`, false, false);
await check('python3 in workspace', 'python3 -c "import os, json; open(\'p.txt\',\'w\').write(\'ok\'); print(json.dumps(os.getcwd()))" && cat p.txt', false, true);
// Security review (M6): no way out through other system services, and nothing outside this run.
const marker = (n: string) => join(home, `sara-sbx-escape-${n}`);
for (const n of ['open', 'osa', 'osa2']) rmSync(marker(n), { force: true });
writeFileSync(join(ws, 'esc.command'), `#!/bin/sh\ntouch ${JSON.stringify(marker('open'))}\n`, { mode: 0o755 });
await check('open -a Terminal (LaunchServices) is refused', 'open -a Terminal ./esc.command', false, false, () => !existsSync(marker('open')));
await check('open a file with its app is refused', 'open ./esc.command', false, false, () => !existsSync(marker('open')));
await check('osascript to System Events is refused', `osascript -e 'tell application "System Events" to do shell script "touch ${marker('osa')}"'`, false, false, () => !existsSync(marker('osa')));
await check('osascript do shell script via Terminal is refused', `osascript -e 'tell application "Terminal" to do script "touch ${marker('osa2')}"'`, false, false, () => !existsSync(marker('osa2')));
await check('pbpaste (pasteboard) is refused', 'pbpaste >/dev/null', false, false);
await check('pbcopy (pasteboard) is refused', 'echo x | pbcopy', false, false);
await check('list /Volumes is refused', 'ls /Volumes', false, false);
await check('list the per-user temp root is refused', `ls ${JSON.stringify(join(tmpdir(), '..'))}`, false, false);
await check('list another run-like temp folder is refused', `ls ${JSON.stringify(tmpdir())}`, false, false);
await check('list /Users is refused', 'ls /Users', false, false);
await check('id / whoami still work (user lookups)', 'id -un && whoami', false, true);
await check('git over https (certificate checks) with network on', 'git ls-remote https://github.com/git/git.git HEAD | grep -q HEAD', true, true);
for (const n of ['open', 'osa', 'osa2']) rmSync(marker(n), { force: true });

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.check} | expected ${r.expect} | ${r.out}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} as expected`);
for (const f of [desk, tmpOut, la]) rmSync(f, { force: true });
rmSync(data, { recursive: true, force: true });
if (results.some((r) => !r.ok)) process.exitCode = 1;
