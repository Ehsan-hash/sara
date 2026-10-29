// Several Saras on one server (deploy/lib-instance.sh): every instance gets its own user, folders,
// settings, units, admin command and port, and the default instance keeps exactly the paths a
// single install always had. These run the real shell scripts under bash (git-bash on Windows) in
// their --dry-run / function-only modes: nothing needs root and nothing outside a temp folder is
// touched. Skipped when no bash is found.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = join(ROOT, 'deploy');
const fwd = (p: string) => p.replace(/\\/g, '/');

/** A real bash: git-bash on Windows (never WSL's bash.exe, which sees other paths). */
function findBash(): string | null {
  const candidates =
    process.platform === 'win32'
      ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe']
      : ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}
const BASH = findBash();
const skip = BASH ? false : 'bash not found';

const tmp = mkdtempSync(join(tmpdir(), 'sara-mi-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function bash(script: string, env: Record<string, string> = {}): { code: number; out: string; err: string } {
  const r = spawnSync(BASH!, ['-c', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', SARA_PORT: '', SARA_INSTANCE: '', ...env } });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}
/** install.sh --dry-run as key → value. */
function plan(args: string, siRoot?: string): Record<string, string> & { _code: string; _err: string } {
  const r = bash(`bash deploy/install.sh --dry-run ${args}`, siRoot ? { SI_ROOT: fwd(siRoot) } : {});
  const o: Record<string, string> = {};
  for (const line of r.out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return Object.assign(o, { _code: String(r.code), _err: r.err });
}
/** A fake server: /etc/<name>/<name>.env files with the given ports. */
function fakeServer(name: string, ports: Record<string, number>): string {
  const root = join(tmp, name);
  for (const [file, port] of Object.entries(ports)) {
    const dir = join(root, 'etc', file.split('/')[0]);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'etc', file), `SARA_HOST=127.0.0.1\nSARA_PORT=${port}\n`);
  }
  mkdirSync(join(root, 'etc', 'systemd', 'system'), { recursive: true });
  return root;
}

const SCRIPTS = [...readdirSync(DEPLOY).filter((f) => f.endsWith('.sh')).map((f) => `deploy/${f}`), 'deploy/sara'];

test('every deploy script passes bash -n', { skip }, () => {
  for (const s of SCRIPTS) {
    const r = spawnSync(BASH!, ['-n', s], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `${s}: ${r.stderr}`);
  }
});

test('shellcheck finds no errors in the deploy scripts (when shellcheck is installed)', { skip }, (t) => {
  let have = false;
  try {
    execFileSync('shellcheck', ['--version'], { stdio: 'ignore' });
    have = true;
  } catch {
    /* not installed */
  }
  if (!have) return t.skip('shellcheck not installed');
  const r = spawnSync('shellcheck', ['-S', 'error', '-x', ...SCRIPTS], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the default instance plans exactly the paths a single install has always used', { skip }, () => {
  const p = plan('', fakeServer('empty', {}));
  assert.equal(p._code, '0', p._err);
  assert.deepEqual(
    {
      instance: p.instance, user: p.user, group: p.group, app_dir: p.app_dir, data_dir: p.data_dir, etc_dir: p.etc_dir,
      env_file: p.env_file, source_dir_file: p.source_dir_file, unit: p.unit, unit_file: p.unit_file,
      updater_path_unit: p.updater_path_unit, updater_service_unit: p.updater_service_unit, updater_dir: p.updater_dir,
      admin_command: p.admin_command, node: p.node, port: p.port, tailscale_https_port: p.tailscale_https_port, caddy_block: p.caddy_block,
    },
    {
      instance: 'sara', user: 'sara', group: 'sara', app_dir: '/opt/sara', data_dir: '/var/lib/sara', etc_dir: '/etc/sara',
      env_file: '/etc/sara/sara.env', source_dir_file: '/etc/sara/source-dir', unit: 'sara.service', unit_file: '/etc/systemd/system/sara.service',
      updater_path_unit: 'sara-updater.path', updater_service_unit: 'sara-updater.service', updater_dir: '/var/lib/sara-updater',
      admin_command: '/usr/local/bin/sara', node: '/opt/sara/node/bin/node', port: '7860', tailscale_https_port: '443', caddy_block: 'sara',
    },
  );
  // SARA_INSTANCE=sara and --instance sara are the same thing.
  assert.deepEqual(plan('--instance sara', join(tmp, 'empty')).app_dir, '/opt/sara');
});

test('an existing default install keeps its own port', { skip }, () => {
  const root = fakeServer('default-7900', { 'sara/sara.env': 7900 });
  const p = plan('', root);
  assert.equal(p.port, '7900');
  assert.equal(p.existing, 'yes');
});

test('two instances never share a user, folder, file, unit, command or port', { skip }, () => {
  // The owner's kind of server: the default Sara on 7860, her demo on 7861, a second one on 7862.
  const root = fakeServer('three', { 'sara/sara.env': 7860, 'sara/sara-demo.env': 7861, 'team/team.env': 7862 });
  const sara = plan('', root);
  const team = plan('--instance team', root);
  const work = plan('--instance work', root);
  for (const p of [sara, team, work]) assert.equal(p._code, '0', p._err);
  assert.equal(team.port, '7862', 'an existing instance keeps her port');
  assert.equal(team.existing, 'yes');
  assert.equal(work.port, '7863', 'a new one takes the next port no listener or other instance has');
  assert.equal(work.existing, 'no');
  assert.equal(team.user, 'team');
  assert.equal(team.env_file, '/etc/team/team.env');
  assert.equal(team.unit, 'team.service');
  assert.equal(team.admin_command, '/usr/local/bin/team');
  assert.equal(team.updater_dir, '/var/lib/team-updater');
  const keys = ['user', 'app_dir', 'data_dir', 'env_file', 'instance_file', 'source_dir_file', 'unit', 'unit_file', 'updater_path_unit', 'updater_service_unit', 'updater_dir', 'admin_command', 'node', 'port', 'tailscale_https_port', 'caddy_block'];
  const plans = [sara, team, work];
  for (let a = 0; a < plans.length; a++)
    for (let b = a + 1; b < plans.length; b++)
      for (const k of keys) assert.notEqual(plans[a][k], plans[b][k], `${plans[a].instance} and ${plans[b].instance} share ${k}`);
  // No path of one is inside another's folder (e.g. /var/lib/sara vs /var/lib/sara-x is fine; /var/lib/sara/x is not).
  for (const x of plans)
    for (const y of plans) {
      if (x === y) continue;
      for (const k of ['app_dir', 'data_dir', 'etc_dir', 'updater_dir']) assert.ok(!y[k].startsWith(`${x[k]}/`), `${y.instance}.${k} is inside ${x.instance}.${k}`);
    }
});

test('a port another instance has, or one asked for that is taken, is refused in the plan', { skip }, () => {
  const root = fakeServer('taken', { 'sara/sara.env': 7860, 'sara/sara-demo.env': 7861 });
  assert.equal(plan('--instance work --port 7861', root).port_status, 'taken');
  assert.equal(plan('--instance work --port 7900', root).port_status, 'free');
  // A port that something listens on (from /proc/net/tcp) is skipped too.
  mkdirSync(join(root, 'proc', 'net'), { recursive: true });
  const hex = (7862).toString(16).toUpperCase().padStart(4, '0');
  writeFileSync(join(root, 'proc', 'net', 'tcp'), `  sl  local_address rem_address   st\n   0: 0100007F:${hex} 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 1 1\n`);
  assert.equal(plan('--instance work', root).port, '7863');
  assert.equal(plan('--port 99', root)._code, '1', 'out-of-range ports are refused');
});

test('bad and reserved instance names are refused', { skip }, () => {
  const root = fakeServer('names', {});
  for (const bad of ['Bad', 'a', '1work', 'work_2', 'work-', 'w--x', 'x'.repeat(33), 'root', 'nobody', 'caddy', 'sara-src', 'sara-demo', 'sara-voice', 'work-updater', 'work-src']) {
    const p = plan(`--instance '${bad}'`, root);
    assert.equal(p._code, '1', `${bad} should be refused`);
    assert.match(p._err, /can't be an instance name|reserved/, bad);
  }
  // Short but unlikely to be a program on the host (e.g. 'ab' is ApacheBench on many servers, and
  // names of existing commands are refused on purpose).
  for (const good of ['work', 'team', 'sara2', 'my-sara', 'qz']) assert.equal(plan(`--instance ${good}`, root)._code, '0', good);
  // SARA_INSTANCE works like --instance.
  const r = bash('bash deploy/install.sh --dry-run', { SI_ROOT: fwd(root), SARA_INSTANCE: 'work' });
  assert.match(r.out, /^unit=work\.service$/m);
});

test('the default service unit is the template unchanged; another instance gets her own', { skip }, () => {
  const template = readFileSync(join(DEPLOY, 'sara.service'), 'utf8');
  const render = (name: string, port: number) => bash(`. deploy/lib-instance.sh; si_set ${name}; si_render_unit /opt/${name}/node/bin/node ${port} < deploy/sara.service`).out;
  assert.equal(render('sara', 7860), template.replaceAll('@NODE@', '/opt/sara/node/bin/node'));
  const team = render('team', 7862);
  for (const line of ['User=team', 'Group=team', 'WorkingDirectory=/opt/team', 'Environment=SARA_DATA=/var/lib/team', 'Environment=SARA_PORT=7862', 'EnvironmentFile=-/etc/team/team.env', 'ExecStart=/opt/team/node/bin/node --disable-warning=ExperimentalWarning /opt/team/src/main.ts', 'ReadWritePaths=/var/lib/team', 'StateDirectory=team', 'Environment=SARA_INSTANCE=team'])
    assert.ok(team.split('\n').includes(line), `missing: ${line}\n${team}`);
  // Nothing of the default Sara's, except hiding her folders from this one (as the demo does).
  assert.doesNotMatch(team.split('\n').filter((l) => !l.startsWith('InaccessiblePaths=')).join('\n'), /\/var\/lib\/sara|\/etc\/sara|\/opt\/sara|^User=sara|7860/m);
  assert.ok(team.includes('InaccessiblePaths=-/var/lib/sara -/etc/sara -/var/lib/sara-demo -/var/lib/sara-updater'));
  // Same hardening and limits as the default.
  for (const line of template.split('\n').filter((l) => /^(NoNewPrivileges|ProtectSystem|ProtectHome|PrivateTmp|PrivateDevices|MemoryMax|TasksMax|UMask)=/.test(l)))
    assert.ok(team.includes(line), line);
});

test('updater units and the admin command are per instance (the default ones unchanged)', { skip }, () => {
  const path = readFileSync(join(DEPLOY, 'sara-updater.path'), 'utf8');
  const svc = readFileSync(join(DEPLOY, 'sara-updater.service'), 'utf8');
  const admin = readFileSync(join(DEPLOY, 'sara'), 'utf8');
  const r = (name: string, fn: string, file: string) => bash(`. deploy/lib-instance.sh; si_set ${name}; ${fn} < ${file}`).out;
  assert.equal(r('sara', 'si_render_updater_path', 'deploy/sara-updater.path'), path);
  assert.equal(r('sara', 'si_render_updater_service', 'deploy/sara-updater.service'), svc);
  const p = r('team', 'si_render_updater_path', 'deploy/sara-updater.path');
  assert.match(p, /^PathExists=\/var\/lib\/team\/update-request$/m);
  assert.match(p, /^Unit=team-updater\.service$/m);
  assert.match(r('team', 'si_render_updater_service', 'deploy/sara-updater.service'), /^ExecStart=\/usr\/local\/bin\/team web-request$/m);
  assert.match(admin, /^SARA_INSTANCE_NAME=sara # set by install\.sh$/m, 'the default admin command manages sara');
  const teamAdmin = r('team', 'si_render_admin', 'deploy/sara');
  assert.match(teamAdmin, /^SARA_INSTANCE_NAME=team # set by install\.sh$/m);
  assert.match(teamAdmin, /Sara admin command/, 'still recognisable as Sara\'s (the installer checks before overwriting)');
  // Every path in the admin command comes from the name: no fixed /var/lib/sara or /etc/sara left
  // outside the default-only branches (the demo, the shared voice/agents folders).
  const fixed = admin.split('\n').filter((l) => !l.trimStart().startsWith('#') && /\/(var\/lib|etc|opt)\/sara(\/|\b)(?!-)/.test(l) && !/sara-demo|sara-agents|sara-voice|sara-src|help\|-h|\/etc\/sara\/sara\.env ]] && echo sara/.test(l));
  assert.deepEqual(fixed, [], fixed.join('\n'));
  // The admin command can print its help for any instance without root.
  const help = bash(`. deploy/lib-instance.sh; si_set team; si_render_admin < deploy/sara > '${fwd(join(tmp, 'team-admin'))}'; bash '${fwd(join(tmp, 'team-admin'))}' help`);
  assert.equal(help.code, 0, help.err);
  assert.match(help.out, /^ {2}team update /m);
  assert.doesNotMatch(help.out, /^ {2}sara /m);
});

test('access settings are per instance: own Caddy block, own Tailscale HTTPS port', { skip }, () => {
  const caddy = join(tmp, 'Caddyfile');
  writeFileSync(caddy, ['# BEGIN sara (managed by "sara access"; this block is replaced when it changes)', 'sara.example.com {', '    reverse_proxy 127.0.0.1:7860', '}', '# END sara', '# BEGIN work (managed by "work access"; this block is replaced when it changes)', 'work.example.com {', '    reverse_proxy 127.0.0.1:7862', '}', '# END work', ''].join('\n'));
  const env = { SARA_CADDYFILE: fwd(caddy) };
  const lib = (name: string, body: string, envFile = '/nonexistent') => bash(`SI_NAME=${name}; ENV_FILE='${envFile}'; . deploy/lib-access.sh; ${body}`, env);
  // The default markers are exactly the old ones.
  assert.equal(lib('sara', 'echo "$SA_CADDY_BEGIN|$SA_CADDY_END"').out.trim(), '# BEGIN sara (managed by "sara access"; this block is replaced when it changes)|# END sara');
  assert.equal(lib('work', 'echo "$SA_CADDY_BEGIN|$SA_CADDY_END"').out.trim(), '# BEGIN work (managed by "work access"; this block is replaced when it changes)|# END work');
  // Taking one instance's site out leaves the other's.
  assert.equal(lib('work', 'sa_caddy_remove_block').code, 0);
  const left = readFileSync(caddy, 'utf8');
  assert.match(left, /# BEGIN sara /);
  assert.match(left, /sara\.example\.com/);
  assert.doesNotMatch(left, /work\.example\.com|# BEGIN work/);
  // Tailscale: one name per machine, so one HTTPS port per instance.
  assert.equal(lib('sara', 'sa_ts_https_port 7860').out.trim(), '443');
  assert.equal(lib('sara', 'sa_ts_https_port 7900').out.trim(), '443');
  assert.equal(lib('team', 'sa_ts_https_port 7862').out.trim(), '8445');
  assert.equal(lib('work', 'sa_ts_https_port 7863').out.trim(), '8446');
  const envFile = join(tmp, 'work.env');
  writeFileSync(envFile, 'SARA_PORT=7863\nSARA_TS_HTTPS_PORT=9443\n');
  assert.equal(lib('work', 'sa_ts_https_port', fwd(envFile)).out.trim(), '9443', 'a remembered port wins');
  // Her own settings file and data folder by default.
  assert.equal(bash('SI_NAME=work; . deploy/lib-access.sh; echo "$ENV_FILE|$SA_DATA_DIR|$SA_CMD"').out.trim(), '/etc/work/work.env|/var/lib/work|work');
  assert.equal(bash('. deploy/lib-access.sh; echo "$ENV_FILE|$SA_DATA_DIR|$SA_CMD"').out.trim(), '/etc/sara/sara.env|/var/lib/sara|sara');
});

test('the app finds its own instance\'s updater (SARA_INSTANCE, default sara)', async () => {
  const { instanceName } = await import('../src/updates.ts');
  assert.equal(instanceName({}), 'sara');
  assert.equal(instanceName({ SARA_INSTANCE: 'work' }), 'work');
  assert.equal(instanceName({ SARA_INSTANCE: '../etc' }), 'sara');
  assert.equal(instanceName({ SARA_INSTANCE: 'Work' }), 'sara');
});
