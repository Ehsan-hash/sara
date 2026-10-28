// Entry point: `node src/main.ts`. Admin flags (the `sara` command on each system wraps them):
//   --version · --status · --doctor · --backup [file] · --restore <file> · --reset-token
//   --tailscale-status (JSON, for the installers' "How will you reach her?" question)
import { DatabaseSync } from 'node:sqlite';
import { StoryWorker } from './story.ts';
import { JobManager } from './jobs.ts';
import { createCodingTools } from './tools/coding.ts';
import { createBrowserTools } from './tools/browser.ts';
import { PreviewManager } from './preview.ts';
import { BrowserManager } from './browser.ts';
import { GoogleAccount } from './google.ts';
import { createGitHubTools } from './tools/github.ts';
import { createHomeTools } from './tools/home.ts';
import { createGoogleTools } from './tools/google.ts';
import { WeeklyWorker } from './weekly.ts';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { copyOffsite, offsiteTestDue, testOffsite } from './offsite-run.ts';
import { formatDoctor, runDoctor } from './doctor.ts';
import { decryptBackup, isEncrypted } from './offsite.ts';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OwnerAuth } from './auth.ts';
import { vaultKeyFor, type AppContext } from './chat.ts';
import { ApprovalBroker, ToolRegistry } from './tools/registry.ts';
import { Redactor, vaultSecretValues } from './redact.ts';
import { SnapshotStore } from './snapshots.ts';
import { MemoryStore } from './memory.ts';
import { MemoryWorker } from './memory-worker.ts';
import { HistoryImporter } from './history-import/index.ts';
import { embedTarget, MemoryVectors } from './embeddings.ts';
import { createTeamTools, TeamManager } from './team.ts';
import { priceTable, UsageStore } from './usage.ts';
import { createStarterTool } from './starters.ts';
import { createProjectNoteTool, ProjectKnowledgeStore } from './projectknow.ts';
import { createSettingsGuideTool } from './settingsguide.ts';
import { createReviewTools } from './codereview.ts';
import { createIssueTool, IssueWatcher } from './issues.ts';
import { createPlannerTools, PlannerStore, type Reminder } from './planner.ts';
import { ReminderScheduler } from './reminders.ts';
import { CompanionHub, EventHub } from './events.ts';
import { InnerStore } from './inner.ts';
import { LifeStore, LifeWorker } from './life.ts';
import { LocalVoiceEngine } from './voice.ts';
import { TelegramBridge } from './bridges/telegram.ts';
import { ApnsSender } from './apns.ts';
import { PushService } from './push.ts';
import { ReportStore } from './reports.ts';
import { Subscriptions } from './subscriptions/index.ts';
import { autoBackupTick, BACKUPS_DIR, backupName, createBackup, DEFAULT_BACKUP, restoreBackup } from './backup.ts';
import { appInfo } from './health.ts';
import { DiscordBridge } from './bridges/discord.ts';
import { McpManager } from './tools/mcp.ts';
import { detectSandbox, lockDataDir, type SandboxInfo, type SandboxPreference } from './tools/sandbox.ts';
import { accessInfo, adminHint, localVoiceMissing, localVoiceSupported } from './platform.ts';
import { statusReport } from './status.ts';
import { tailscaleStatus } from './tailscale.ts';
import { createWebSearchTool } from './tools/search.ts';
import { mcpSecrets, searchConfig } from './integrations.ts';
import { loadPersona } from './persona.ts';
import { createSaraServer, proxyTrust } from './server.ts';
import { UploadStore } from './uploads.ts';
import { BriefingWorker } from './briefing.ts';
import { LeaveByWorker } from './leaveby.ts';
import { ReviewWorker } from './review.ts';
import { createPhotoTools, DEFAULT_IMAGE_MODEL, photoSettings, xaiImageKey } from './photos.ts';
import { LookBuilder, PLACES } from './look.ts';
import { createWardrobeTool, WardrobeWorker } from './wardrobe.ts';
import { createSharedListTool, TogetherStore } from './together.ts';
import { createScrapbookTool, Scrapbook } from './scrapbook.ts';
import { migrateProviderLabels, SettingsStore, StartupError } from './settings.ts';
import { Store } from './store.ts';
import { Vault } from './vault.ts';
import { guard, Log } from './log.ts';
import { ModelCatalog } from './model-catalog.ts';
import { createProvider } from './providers/registry.ts';
import { HealthHistory } from './health-history.ts';
import { createRecallTool } from './recall.ts';
import { LibraryStore } from './library/store.ts';
import { LibraryWorker } from './library/worker.ts';
import { createLibraryTool } from './library/use.ts';
import { CodeMaps } from './codemap/index.ts';
import { createCodeTools } from './codemap/tools.ts';
import { createRecipeTools, RecipeStore } from './recipes.ts';
import { workspaceDir } from './tools/workspace.ts';
import { createTuneTool } from './studio.ts';
import { DriftStore } from './drift.ts';
import { paceFactor, tensionHalfLife } from './bond.ts';
import { CompanionManager, CompanionSettings, companionDirs, LinkedToolRegistry, MAIN_ID, type Companion } from './companions.ts';
import { pickCompanion } from './server.ts';
import { createServer } from 'node:http';

// A promise nobody waited for that failed: log it and carry on (a background job, a model call
// whose answer was no longer needed). A thrown error nothing caught: log it plainly and stop, so
// the service manager starts a clean server again.
process.on('unhandledRejection', (err) => console.warn(`Background task failed: ${(err as Error)?.stack ?? err}`));
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (err instanceof StartupError || code === 'ENOTDIR' || code === 'EACCES' || code === 'ENOSPC' || code === 'EROFS') {
    console.error(`\nSara can't start: ${err instanceof StartupError ? err.message : err.message}`);
    if (code === 'ENOSPC') console.error('The disk is full. Free some space, then start her again.');
    const dir = resolve(process.env.SARA_DATA ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data'));
    let newest = '';
    try {
      newest = readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.tar.gz')).sort().at(-1) ?? '';
    } catch {
      newest = '';
    }
    if (newest) console.error(`Your newest backup is ${join(dir, 'backups', newest)}. To go back to it: ${adminHint(`restore ${join(dir, 'backups', newest)}`)}  (without the installer: node src/main.ts --restore <file>)`);
    else if (err instanceof StartupError) console.error(`There is no backup in the data folder yet. If you have one elsewhere: ${adminHint('restore <file>')}.`);
    process.exit(1);
  }
  console.error(`Sara stopped because of an unexpected error (she restarts by herself when run as a service):\n${err.stack ?? err}`);
  process.exit(1);
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.SARA_DATA ?? join(root, 'data'));
const host = process.env.SARA_HOST ?? '127.0.0.1';
const port = Number(process.env.SARA_PORT ?? 7860);
const defaultPersonaPath = resolve(process.env.SARA_PERSONA ?? join(root, 'persona', 'sara.json'));

// Flags that read only (nothing is created): the installers and the `sara` command use them.
if (process.argv.includes('--version')) {
  const i = appInfo(root);
  console.log(`Sara ${i.version}${i.revision ? ` (${i.revision})` : ''}`);
  process.exit(0);
}
if (process.argv.includes('--tailscale-status')) {
  console.log(JSON.stringify(tailscaleStatus(), null, 2));
  process.exit(0);
}
if (process.argv.includes('--status')) {
  const i = appInfo(root);
  const running = await fetch(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.status < 500, () => false);
  console.log(statusReport({ version: i.version, dataDir, port, running, access: accessInfo() }));
  process.exit(0);
}

if (existsSync(dataDir) && !statSync(dataDir).isDirectory()) throw new StartupError(`Her data folder ${dataDir} (SARA_DATA) is a file, not a folder.`);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const auth = new OwnerAuth(dataDir);

/** The newest owner token, kept only until it's used once (the installer shows it from here). */
export const FIRST_TOKEN_FILE = 'first-token.txt';
function banner(token: string): void {
  // Straight to the console, never into the log file (Phase 30).
  const reset = process.env.SARA_DATA === '/data' && !existsSync('/usr/local/bin/sara') ? 'docker compose exec sara node src/main.ts --reset-token (then restart it)' : adminHint('reset-token');
  process.stdout.write(`\n================================================================\n Sara owner token (shown once, store it in your password manager):\n   ${token}\n Reset it any time with: ${reset}\n================================================================\n\n`);
  // Also in a file only Sara's user can read, until the first sign-in with it (then it's deleted),
  // so the installer can show it without anyone digging through system logs.
  try {
    writeFileSync(join(dataDir, FIRST_TOKEN_FILE), `${token}\n`, { mode: 0o600 });
  } catch {
    // not fatal: the console line above has it
  }
}

if (process.argv.includes('--reset-token')) {
  // The server-side recovery: also turns off passkeys and two-step sign-in (lost phone).
  const had = auth.passkeys().length > 0 || auth.twoStepOn;
  banner(auth.resetToken({ clearSecurity: true }));
  if (had) console.log(' Passkeys and two-step sign-in were turned off. Set them up again in Settings → Devices and sign-in.');
  process.exit(0);
}

const info = appInfo(root);
const argAfter = (flag: string) => {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
};
if (process.argv.includes('--backup')) {
  const out = resolve(argAfter('--backup') ?? join(dataDir, BACKUPS_DIR, backupName(new Date())));
  const m = createBackup(dataDir, out, { saraVersion: info.version, includeWorkspaces: !process.argv.includes('--no-workspaces') });
  console.log(`Backup written: ${out} (${m.files} files). It contains your keys: keep it private.`);
  process.exit(0);
}
if (process.argv.includes('--restore')) {
  const file = argAfter('--restore');
  if (!file) {
    console.error('Usage: node src/main.ts --restore <backup.tar.gz>');
    process.exit(2);
  }
  const running = await fetch(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/health`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
  if (running) {
    console.error(`Sara is running on port ${port}. Stop her first (${process.platform === 'linux' && existsSync('/usr/local/bin/sara') ? 'sudo systemctl stop sara' : adminHint('stop')}), then restore.`);
    process.exit(1);
  }
  let source = resolve(file);
  // An encrypted off-server copy: decrypt it first (passphrase from SARA_BACKUP_PASSPHRASE).
  if (isEncrypted(readFileSync(source).subarray(0, 8))) {
    const pass = process.env.SARA_BACKUP_PASSPHRASE;
    if (!pass) {
      console.error(`This backup is encrypted. Set SARA_BACKUP_PASSPHRASE (${adminHint('restore')} asks for it).`);
      process.exit(2);
    }
    try {
      const plain = decryptBackup(readFileSync(source), pass);
      // Beside (not inside) the data folder, which the restore moves aside; removed afterwards.
      source = `${dataDir.replace(/[\\/]+$/, '')}.decrypted-${process.pid}.tar.gz`;
      writeFileSync(source, plain, { mode: 0o600 });
      const tmp = source;
      process.on('exit', () => rmSync(tmp, { force: true }));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }
  try {
    const r = restoreBackup(source, dataDir);
    console.log(`Restored backup from ${r.manifest.createdAt} (Sara ${r.manifest.saraVersion}). Previous data kept in ${r.movedTo}.`);
    process.exit(0);
  } catch (err) {
    console.error(`Restore failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

const sandboxPref = (process.env.SARA_SANDBOX ?? 'auto') as SandboxPreference;
const settings = new SettingsStore(dataDir);
{
  const renamed = migrateProviderLabels(settings.get());
  if (renamed) settings.update({ providers: renamed.providers });
  // Phase 16: adult content became a switch (off by default). Servers set up before it existed
  // had adult content available, so they ask the owner once.
  if (!settings.get().adultMode) settings.update({ adultMode: settings.get().disclosureAcceptedAt ? { on: false, ask: true } : { on: false } });
}
const vault = new Vault(dataDir, process.env.SARA_MASTER_KEY);
if (process.argv.includes('--doctor')) {
  let sb: SandboxInfo;
  try {
    sb = detectSandbox(sandboxPref, true, { dataDir });
  } catch (err) {
    sb = { mode: 'none', network: true, detail: (err as Error).message };
  }
  const tools = new ToolRegistry();
  tools.unsandboxed = sb.mode === 'none';
  const checks = await runDoctor({ dataDir, settings, vault, subscriptions: new Subscriptions(vault, dataDir), sandbox: sb, tools });
  console.log(formatDoctor(checks));
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  console.log(`\n${fails ? `${fails} problem(s)` : 'No problems'}${warns ? `, ${warns} thing(s) to look at` : ''}.`);
  process.exit(fails ? 1 : 0);
}
const sandbox = detectSandbox(sandboxPref, true, { dataDir });
if (sandbox.mode === 'user') {
  // New files are private to the server (and the tools group inside workspaces); existing ones too.
  process.umask(0o007);
  lockDataDir(dataDir);
}
const redactor = new Redactor(() => vaultSecretValues(vault.values()));
// Phase 30: a copy of everything Sara prints goes to <data>/logs/sara.log (secrets hidden).
const log = new Log(dataDir, (s) => redactor.redact(s));
log.captureConsole();
const isDemo = process.env.SARA_DEMO === '1';
// The demo lets anyone in without signing in, so it must never run on a real owner's data.
if (isDemo && existsSync(join(dataDir, 'sara.db'))) {
  const db = new DatabaseSync(join(dataDir, 'sara.db'), { readOnly: true });
  try {
    const has = (table: string) => {
      try {
        return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n) > 0;
      } catch {
        return false; // no such table yet
      }
    };
    if (['conversations', 'memories', 'notes', 'tasks', 'reminders', 'library_docs'].some(has)) throw new StartupError(`SARA_DEMO=1 is set, but ${dataDir} holds someone's conversations or notes. The demo lets visitors in without signing in, so it only runs on its own empty data folder (deploy/install-demo.sh makes one).`);
  } finally {
    db.close();
  }
}
const webDir = join(root, 'web');

// ---- Shared by every companion (Phase 31) ----
// Add-on (MCP) tools run once, in the first companion's tool list; the others link to them.
const mainTools = new ToolRegistry();
// Phase 46: no sandbox (Windows, or none found): commands ask first unless the owner chose otherwise.
mainTools.unsandboxed = sandbox.mode === 'none';
const mcp = new McpManager(mainTools, { dataDir, sandbox, secrets: (name) => mcpSecrets(vault, name) });
const events = new EventHub();
const subscriptions = new Subscriptions(vault, dataDir);
const google = new GoogleAccount(vault);
// Local voice tools are Linux only for now (deploy/install-voice.sh).
const voice = new LocalVoiceEngine(resolve(process.env.SARA_VOICE_DIR ?? (localVoiceSupported() ? '/opt/sara-voice' : join(dataDir, 'voice'))), dataDir);
const companions = new CompanionManager(dataDir);
// Phase 49: preview links (one list for the whole server) and the testing browsers.
const previews = new PreviewManager({ ownPorts: () => [port] });
const browsers = new BrowserManager({ sandbox: () => sandbox, previews, sweep: true });
// Phase 50: the code maps of the workspaces (one per workspace, shared like the workspaces; a
// rebuildable cache, so backups leave it out). Meaning search uses the first companion's job.
const codemaps = new CodeMaps({ cacheDir: join(dataDir, 'cache', 'codemap'), target: () => embedTarget(companions.main.app) });
let push: PushService | undefined;
let healthHistory: HealthHistory | undefined;
let bridges: AppContext['bridges'];
const serverOpts = {
  auth,
  info,
  webDir,
  secureCookies: process.env.SARA_SECURE_COOKIES === '1',
  trustProxy: proxyTrust(process.env, dataDir),
  // Demo server for app review and trying Sara out (Phase 16).
  demo: isDemo,
  // This server is the app developer's report inbox (Phase 19).
  reportInbox: process.env.SARA_REPORT_INBOX === '1',
  ...(process.env.SARA_REPORT_TO ? { reportTo: process.env.SARA_REPORT_TO } : {}),
  ...(process.env.SARA_DEMO_DAILY ? { demoDaily: Number(process.env.SARA_DEMO_DAILY) } : {}),
  // Demo live calls for app review: only with this reviewer code (unset = no calls in the demo),
  // 5 minutes a call, and SARA_DEMO_CALL_MINUTES_PER_DAY minutes a day for everyone (default 30).
  ...(isDemo && process.env.SARA_DEMO_CALL_CODE?.trim() ? { demoCallCode: process.env.SARA_DEMO_CALL_CODE.trim() } : {}),
  ...(isDemo && process.env.SARA_DEMO_CALL_MINUTES_PER_DAY && Number.isFinite(Number(process.env.SARA_DEMO_CALL_MINUTES_PER_DAY)) ? { demoCallMinutesPerDay: Math.max(0, Number(process.env.SARA_DEMO_CALL_MINUTES_PER_DAY)) } : {}),
  companions,
};

/** Builds one companion: the first lives in the data folder itself, the others in companions/<id>/. */
// Phase 56: every provider's model list, kept current (one for the server; never on the demo).
const modelCatalog = isDemo
  ? undefined
  : new ModelCatalog(dataDir, {
      settings,
      providerFor: (config) => createProvider(config, vault.get(vaultKeyFor(config.id)), subscriptions),
      companions: () => companions.all().map((c) => ({ name: c.app.persona.name, settings: c.app.settings })),
    });

function buildCompanion(id: string, dir: string): Companion {
  const main = id === MAIN_ID;
  const settingsC = main ? settings : new CompanionSettings(dir, settings);
  const tools = main ? mainTools : new LinkedToolRegistry(mainTools);
  tools.add(createWebSearchTool(() => searchConfig(settingsC, vault)));
  const store = new Store(join(dir, 'sara.db'));
  const memory = new MemoryStore(store.db);
  // The planner: the first companion's, shared, unless the owner chose separate planners.
  const sharedPlanner = !main && settings.get().companionPlanner !== 'separate';
  const planner = sharedPlanner ? companions.main.app.planner! : new PlannerStore(store.db);
  for (const t of createPlannerTools({ planner, now: () => new Date(), timeZone: () => settingsC.get().timeZone, callsOn: () => settingsC.get().calls?.enabled === true })) tools.add(t);
  const uploads = new UploadStore(dir);
  const xaiProviderKeyOf = () => {
    const p = settingsC.get().providers.find((x) => /api\.x\.ai/.test(x.baseUrl));
    return p ? vault.get(vaultKeyFor(p.id)) : undefined;
  };
  const scrapbook = new Scrapbook(store.db);
  tools.add(createScrapbookTool(scrapbook));
  // Phase 32: she can look through her past conversations.
  tools.add(createRecallTool(() => app));
  // Phase 44: her library (documents she keeps), and the tool to look things up in it.
  tools.add(createLibraryTool(() => app));
  // Phase 34: she can adjust her own dials when asked (the owner approves each change).
  tools.add(createTuneTool(() => app));
  // Phase 50: the code map tools and her recipes.
  for (const t of createCodeTools(() => app.codemap)) tools.add(t);
  for (const t of createRecipeTools(() => app)) tools.add(t);
  for (const t of createPhotoTools({
    webDir,
    uploads,
    settings: settingsC,
    vault,
    xaiProviderKey: xaiProviderKeyOf,
    persona: () => app.persona,
    // Phase 43: shared channels (owner work in a Discord channel or Telegram group) stay non-explicit.
    channelOf: (id) => store.getConversation(id)?.channel,
    grokSignedIn: () => subscriptions.grokStatus().signedIn,
    grokToken: async () => subscriptions.grokAccessToken(),
    lookFile: (rel) => app.look?.fileFor(rel),
    wearing: () => {
      const meta = app.look?.custom ? app.look.currentMeta() : {};
      return { wear: meta.wear, place: meta.place ? (PLACES[meta.place]?.prompt ?? meta.place) : undefined };
    },
    faceRef: () => app.look?.faceRef(),
    customPortrait: () => {
      // Phase 36: her current look (the outfit she's wearing now), then an uploaded picture.
      const lookFile = app.look?.fileFor('sara-portrait.jpg');
      if (lookFile) return readFileSync(lookFile);
      for (const ext of ['jpg', 'png', 'webp']) {
        const f = join(dir, `avatar.${ext}`);
        if (existsSync(f)) return readFileSync(f);
      }
      return undefined;
    },
  }))
    tools.add(t);
  const app: AppContext = {
    store,
    log,
    uploads,
    settings: settingsC,
    vault,
    // Her edited character (Settings → Character) overrides the default sheet.
    persona: loadPersona(existsSync(join(dir, 'persona.json')) ? join(dir, 'persona.json') : defaultPersonaPath),
    defaultPersonaPath,
    now: () => new Date(),
    dataDir: dir,
    rootDir: dataDir,
    companionId: id,
    companions,
    tools,
    approvals: new ApprovalBroker(),
    sandbox,
    mcp,
    redactor,
    snapshots: new SnapshotStore(dataDir),
    memory,
    codemap: codemaps,
    recipes: new RecipeStore(store.db),
    // Phase 44: her own library, or the first companion's when the owner shares one.
    library: !main && settings.get().companionLibrary === 'shared' ? companions.main.app.library : new LibraryStore(store.db, dir),
    drift: new DriftStore(store.db),
    planner,
    events: new CompanionHub(events, id),
    inner: new InnerStore(store.db, undefined, { tensionHalfLife: () => tensionHalfLife(app.persona.traits?.forgiveness), closenessRate: () => paceFactor(app.persona.traits?.pace) }),
    life: new LifeStore(store.db),
    scrapbook,
    look: new LookBuilder({
      dataDir: dir,
      key: async () => (await xaiImageKey({ vault, xaiProviderKey: xaiProviderKeyOf, grokToken: async () => subscriptions.grokAccessToken() })) ?? undefined,
      model: () => photoSettings(settingsC).model || DEFAULT_IMAGE_MODEL,
      faceLock: () => settingsC.get().faceLock !== false,
    }),
    voice,
    subscriptions,
    google,
  };
  // The health history and notifications are the server's: one of each, shared.
  healthHistory ??= new HealthHistory(store.db, { problems: () => log.problems, dataDir });
  app.healthHistory = healthHistory;
  if (!push) {
    push = new PushService(store.db, vault, settings);
    push.apns = new ApnsSender(store.db, vault);
  }
  app.push = push;
  // Phase 52: the cost and token meter (the owner's prices win over the shipped ones).
  if (modelCatalog) app.modelCatalog = modelCatalog;
  app.usage = new UsageStore(store.db);
  app.usage.prices = () => priceTable(settingsC.get().prices);
  // Phase 13: background jobs, git and delegating to Claude Code / Grok Build.
  app.jobs = new JobManager(app, store.db);
  app.reports = new ReportStore(store.db, app.now);
  for (const t of createCodingTools(app)) tools.add(t);
  // Phase 49: previews of the web apps her jobs run, and her testing browser.
  app.previews = previews;
  app.browsers = browsers;
  app.jobs.onEnd = (job) => {
    previews.jobEnded(job.id, app.jobs);
    // Phase 50: a finished job may have changed files: the code map looks again.
    try {
      codemaps.touch(workspaceDir(dataDir, job.workspace));
    } catch {
      /* not a workspace name */
    }
  };
  for (const t of createBrowserTools(app)) tools.add(t);
  for (const t of createGitHubTools(app)) tools.add(t);
  // Phase 29: Home Assistant (off until the owner connects it).
  for (const t of createHomeTools(app)) tools.add(t);
  // Phase 14: Gmail and Google Calendar (the owner's own Google app; off until they sign in).
  for (const t of createGoogleTools(google, () => settingsC.get().timeZone)) tools.add(t);

  // Phase 38: meaning search (vectors made a few at a time while the embeddings job is set).
  app.vectors = new MemoryVectors(store.db, memory, () => embedTarget(app));
  let vectorTimer: NodeJS.Timeout | undefined;
  const indexVectors = () => guard('embeddings', () => app.vectors!.index());
  const memoryWorker = new MemoryWorker(app, memory);
  app.memoryNudge = () => memoryWorker.nudge();
  // Phase 44: a shared library is read (and learned into memory) by the first companion's worker.
  const ownsLibrary = main || settings.get().companionLibrary !== 'shared';
  const libraryWorker = ownsLibrary ? new LibraryWorker(app, () => app.library) : undefined;
  app.libraryNudge = ownsLibrary ? () => libraryWorker!.nudge() : () => companions.main.app.libraryNudge?.();
  // With a shared planner, each companion delivers the reminders set in her own conversations;
  // the first one also takes those whose conversation is gone.
  const owns = sharedPlanner
    ? (r: Reminder) => Boolean(r.conversationId && store.getConversation(r.conversationId))
    : main
      ? (r: Reminder) => !r.conversationId || Boolean(store.getConversation(r.conversationId)) || !companions.byConversation(r.conversationId)
      : undefined;
  const reminders = new ReminderScheduler(app, planner, owns ? { owns } : {});
  app.reminders = reminders;
  const lifeWorker = new LifeWorker(app, app.life!, app.inner!);
  // Phase 12: weekly reflection and her life threads.
  const weeklyWorker = new WeeklyWorker(app, memory, app.life);
  app.weekly = weeklyWorker;
  app.briefing = new BriefingWorker(app);
  app.leaveBy = new LeaveByWorker(app);
  app.review = new ReviewWorker(app);
  // Phase 53: your story together (look backs, the optional yearly one).
  app.story = new StoryWorker(app);
  // Phase 39: team tasks she leads (helpers with their own models, tools and approvals).
  app.team = new TeamManager(app, store.db);
  for (const t of createTeamTools(() => app)) tools.add(t);
  // Phase 52: new projects from tested starter templates.
  tools.add(createStarterTool(() => app));
  // Phase 40: project knowledge, review mode, GitHub issues as tasks (watching is off by default).
  app.projects = new ProjectKnowledgeStore(app, store.db);
  tools.add(createProjectNoteTool(() => app));
  tools.add(createSettingsGuideTool());
  for (const t of createReviewTools(() => app)) tools.add(t);
  tools.add(createIssueTool(() => app));
  const issueWatcher = new IssueWatcher(app);
  // Phase 37: things to do together and shared lists.
  app.together = new TogetherStore(store.db, () => app.now());
  tools.add(createSharedListTool(() => app.together));
  // Phase 36: her closet (dresses for the scenario when the owner turns it on).
  const wardrobe = new WardrobeWorker(app);
  app.wardrobe = wardrobe;
  // Phase 51: bring your history (ChatGPT / Claude exports), learned from a few a minute.
  app.historyImport = new HistoryImporter(() => app);
  tools.add(createWardrobeTool(() => app));
  // Telegram and Discord: one bot each, for the first companion (shared with the others' settings).
  if (main) bridges = { telegram: new TelegramBridge(app), discord: new DiscordBridge(app) };
  app.bridges = bridges;
  const server = createSaraServer({ ...serverOpts, app });
  return {
    id,
    app,
    server,
    start() {
      memoryWorker.start();
      libraryWorker?.start();
      vectorTimer = setInterval(indexVectors, 60_000);
      if (!isDemo) issueWatcher.start();
      // Team tasks that were running when the server stopped carry on.
      setTimeout(() => app.team?.resumeInterrupted(), 15_000).unref();
      setTimeout(indexVectors, 5_000).unref();
      reminders.start();
      lifeWorker.start();
      weeklyWorker.start();
      app.briefing!.start();
      app.leaveBy!.start();
      app.review!.start();
      if (!isDemo) app.story!.start();
      if (!isDemo) wardrobe.start();
      // Learning from imported history that was still going when the server stopped carries on.
      if (!isDemo) setTimeout(() => app.historyImport?.start(), 20_000).unref();
    },
    async stop() {
      app.jobs?.stopAll();
      // Running replies stop and save what they have (the app then offers Continue).
      await app.stopAllTurns?.().catch(() => {});
      memoryWorker.stop();
      libraryWorker?.stop();
      clearInterval(vectorTimer);
      issueWatcher.stop();
      app.story?.stop();
      reminders.stop();
      lifeWorker.stop();
      weeklyWorker.stop();
      app.briefing?.stop?.();
      app.leaveBy?.stop?.();
      app.review?.stop?.();
      wardrobe.stop();
      app.historyImport?.stop();
    },
  };
}
companions.build = buildCompanion;
companions.add(buildCompanion(MAIN_ID, dataDir));
// The other companions (not on the demo server).
if (!isDemo) for (const c of companionDirs(dataDir)) companions.add(buildCompanion(c.id, c.dir));
const mainApp = companions.main.app;
console.log(`Tool sandbox: ${sandbox.mode} (${sandbox.detail})`);
{
  const b = browsers.status();
  console.log(`Testing browser: ${b.found ? `${b.name} (${b.path})` : `none (${b.how})`}`);
}
const va = voice.available;
console.log(`Local voice: ${va.stt || va.tts ? `speech-to-text ${va.stt ? 'yes' : 'no'}, voices ${voice.voices().length} (${voice.dir})` : localVoiceMissing()}`);
if (companions.all().length > 1) console.log(`Companions: ${companions.all().map((c) => c.app.persona.name).join(', ')}`);

// Notifications: every companion's messages and calls, named after the one who sent them.
events.subscribe((ev) => {
  const c = companions.get(ev.companion) ?? companions.main;
  void push!.onEvent(ev, c.app.persona.name, (id) => Boolean(companions.byConversation(id)?.app.store.getConversation(id)?.partner), (s) => redactor.redact(s)).catch((err: Error) => console.warn(`push: ${err.message}`));
});

function backupTick(): void {
  // The demo server keeps nothing worth backing up (visitors are in memory only).
  if (isDemo) return;
  try {
    const name = autoBackupTick(dataDir, { ...DEFAULT_BACKUP, ...settings.get().backup }, new Date(), info.version);
    if (name) {
      console.log(`Automatic backup: ${name}`);
      void copyOffsite(mainApp, join(dataDir, BACKUPS_DIR, name)).then(
        (r) => r && console.log(`Off-server copy: ${r}`),
        (err: Error) => console.warn(`Off-server copy failed: ${err.message}`),
      );
    }
  } catch (err) {
    console.warn(`Automatic backup failed: ${(err as Error).message}`);
  }
  // Phase 30: once a week, prove the newest off-server copy really restores (temporary folder).
  if (offsiteTestDue(mainApp)) {
    void testOffsite(mainApp).then((r) => (r.ok ? console.log(`Off-server test restore: ok (${r.name}: ${r.detail})`) : console.warn(`Off-server test restore failed: ${r.error}`)));
  }
}
// Checked hourly (and 2 minutes after start); a backup is made when the last one is a day old.
const backupTimer = setInterval(() => guard('backup', backupTick), 3600_000);
backupTimer.unref();
setTimeout(() => guard('backup', backupTick), 120_000).unref();

// Phase 31: one front server; each request goes to the right companion (see pickCompanion).
const server = createServer((req, res) => {
  pickCompanion(companions, req).server.emit('request', req, res);
});
server.on('upgrade', (req, socket, head) => {
  pickCompanion(companions, req).server.emit('upgrade', req, socket, head);
});

server.listen(port, host, () => {
  if (auth.newToken) banner(auth.newToken);
  // Reachable from other machines without HTTPS: sign-in tokens and cookies would cross the
  // network readable by anyone on it.
  if (!/^(127\.|::1$|localhost$)/.test(host) && process.env.SARA_SECURE_COOKIES !== '1') {
    console.warn(`Warning: Sara is listening on ${host}:${port} without HTTPS. Anyone on that network can read the sign-in token and cookies. Put an HTTPS reverse proxy in front (docs/INSTALL.md, section 2) and set SARA_SECURE_COOKIES=1, or listen on 127.0.0.1.`);
  }
  console.log(`Sara is listening on http://${host}:${port} (data: ${dataDir})${isDemo ? ' [DEMO]' : ''}`);
  for (const c of companions.all()) c.start();
  codemaps.start();
  modelCatalog?.start(guard);
  if (!isDemo) healthHistory?.start();
  void bridges?.discord?.restart().then(() => {
    const st = bridges!.discord!.status();
    if (st.running || st.error) console.log(`Discord: ${st.running ? `${st.bot} ${st.linked ? '(linked)' : '(not linked yet)'}` : `not running (${st.error})`}`);
  });
  void bridges?.telegram?.restart().then(() => {
    const st = bridges!.telegram!.status();
    if (st.running || st.error) console.log(`Telegram: ${st.running ? `@${st.bot} ${st.linked ? '(linked)' : '(not linked yet)'}` : `not running (${st.error})`}`);
  });
  void mcp.startAll(settings.get().mcpServers ?? []).then(() => {
    for (const c of settings.get().mcpServers ?? []) {
      const conn = mcp.get(c.name);
      if (conn && c.enabled) console.log(`MCP ${c.name}: ${conn.status}${conn.error ? ` (${conn.error})` : ` (${conn.tools.length} tools)`}`);
    }
  });
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of companions.all()) await c.stop();
  await browsers.closeAll().catch(() => {});
  codemaps.stop();
  modelCatalog?.stop();
  healthHistory?.stop();
  clearInterval(backupTimer);
  bridges?.telegram?.stop();
  bridges?.discord?.stop();
  mcp.stopAll();
  server.close(() => {
    for (const c of companions.all()) c.app.store.close();
    codemaps.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
// Phase 46c: Windows has no SIGTERM. Her service host (SaraService.exe) asks her to stop by closing
// her stdin, so she can finish writing and close the database cleanly.
if (process.env.SARA_STOP_ON_STDIN_END === '1') {
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('error', () => void shutdown());
  process.stdin.resume();
}
