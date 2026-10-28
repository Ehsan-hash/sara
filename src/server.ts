// HTTP API + static web UI. No framework; node:http only.
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { appLanguage, en, fill, toLang, trOwner } from './i18n.ts';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { qrSvg } from './qr.ts';
import { DemoCallGate } from './demo-calls.ts';
import { accessInfo, adminHelp, localVoiceMissing, localVoiceSupported, systemName } from './platform.ts';
import { checklist } from './checklist.ts';
import { findEverything } from './find.ts';
import { newChallenge, verifyAssertion, verifyRegistration } from './webauthn.ts';
import { Updater } from './updates.ts';
import { reviewSettings } from './review.ts';
import { exportCharacter, parseCharacter, withCharacterVoice } from './characterfile.ts';
import { HistoryImporter, MAX_HISTORY_BYTES, saveUpload } from './history-import/index.ts';
import { isHistorySource, SOURCE_NAME } from './history-import/types.ts';
import { CompanionImporter, type ConfirmInput } from './companion-import/session.ts';
import { MAX_FILE_BYTES, MAX_ZIP_BYTES, PICKABLE_SOURCES } from './companion-import/types.ts';
import { galleryEntry, galleryLine, galleryList, NoBrainError } from './gallery.ts';
import { findAddress, leaveBySettings } from './leaveby.ts';
import { DEFAULT_REPORT_INBOX, REASON_LABELS, validReason } from './reports.ts';
import { LiveCall, OPENAI_LIVE_MODELS, OPENAI_LIVE_VOICES, type ConnectUpstream } from './live.ts';
import { ReminderScheduler } from './reminders.ts';
import { CallBroker, callRules, cleanCallRules, openingNote, type CallRules } from './calls.ts';
import { speechOf } from './speech.ts';
import { EXPRESSIVE_SAMPLE, type Expressive, type VoiceTone } from './expressive.ts';
import { acceptWebSocket, refuseUpgrade } from './ws.ts';
import { previewUrl } from './preview.ts';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { DEVICE_TOKEN_PREFIX, deviceLabel, LoginLimiter, OwnerAuth, SESSION_COOKIE } from './auth.ts';
import type { FirstClaim } from './claim.ts';
import { cleanScope, DeviceFlow } from './device-flow.ts';
import { handleOpenAI } from './openai-api.ts';
import { handleMcp } from './mcp-server.ts';
import { cleanOrigins, DEFAULT_APP_NAME, KeyLimiter, otherAppsSettings } from './other-apps.ts';
import { CardError, cardPng, cardToCharacter, isPng, MAX_CARD_JSON, MAX_CARD_PNG, parseCardFile, personaToCard, placeholderPicture, portraitPng, type CardImport } from './character-cards.ts';
import { cleanBudget, cleanPrices, DEFAULT_PRICES, mergeSummaries, priceTable, usageLine } from './usage.ts';
import { createFromStarter, listStarters } from './starters.ts';
import { MAX_IMAGES_PER_MESSAGE, UploadError } from './uploads.ts';
import { briefingSettings, defaultUnits, geocode } from './briefing.ts';
import { copyOffsite, offsiteSettings, testOffsite } from './offsite-run.ts';
import { createCompanionDir, newCompanionPersona, retireCompanionDir } from './companions.ts';
import { runDoctor } from './doctor.ts';
import { DEFAULT_IMAGE_MODEL, PHOTO_KEY_VAULT, photoSettings } from './photos.ts';
import { cleanMeta, isAdultOutfit, LOOK_STYLES, type LookMeta, OUTFITS, outfitPrompt, PARTS, PLACES } from './look.ts';
import { ACTIVITIES, type ListId, LISTS, TogetherStore } from './together.ts';
import { allScenarios, cleanWardrobe, type WardrobeSettings, wardrobeSettings } from './wardrobe.ts';
import { type CharacterChoices, quickCharacter, RELATIONSHIPS, TALK, VIBES, writeCharacter } from './character.ts';
import { checkIssues, cleanWatch, openIssues, startFromIssue, watchSettings, type OpenIssue } from './issues.ts';
import { cleanHelpers, cleanLimits, ROLES, teamHelpers, type TeamLimits, type TeamTask } from './team.ts';
import { comparePrompt, compareModels, connectedModels, costHint, isCloudModel, JOBS, recommend, testModel } from './modelpicks.ts';
import { applyArchetype, applyRelationship, applyTalk, ARCHETYPES, fillLife, fillLifeQuick, makeUnique, savePersona, SCENARIOS, surprise, trySamples } from './studio.ts';
import { HUMOURS, LIFE_FIELDS, QUIET_FOCUS, TRAITS } from './traits.ts';
import { AWAY, CONFLICT, INTIMACY_LEVELS, intimacyLevel, OTHERS, RELATIONSHIP_INFO } from './bond.ts';
import { OFFSITE_PASS_VAULT, OFFSITE_S3_VAULT } from './offsite.ts';
import { bondContext, HISTORY_BUDGET_CHARS, resolveChain, runTurn, type TurnOptions, vaultKeyFor, type AppContext, type ChatEvent } from './chat.ts';
import { createProvider, PROVIDER_PRESETS, validateProviderConfig } from './providers/registry.ts';
import { DISCLOSURE_TEXT, detectMinorSexualContent, disclosureText } from './safety.ts';
import { personalize } from './identity.ts';
import { stripTypeScriptTypes } from 'node:module';
import { adultModeOn, ROUTE_PURPOSES, type RoutePurpose, type Settings } from './settings.ts';
import { proactiveSettings } from './life.ts';
import { expressionFor, leansPlayful, moodLabel } from './inner.ts';
import { identityOf, loadPersona, SAFETY_BOUNDARIES, validatePersona, type Persona } from './persona.ts';
import { cleanTags, CONVERSATION_MODES, importedName, Store, type Conversation, type ConversationMode, type StoredMessage } from './store.ts';
import { ToolRegistry } from './tools/registry.ts';
import { clip, PERMISSIONS, type Permission } from './tools/types.ts';
import { resolveInside, WORKSPACE_NAME_RE, workspaceDir } from './tools/workspace.ts';
import { runCommand, noSandboxNote } from './tools/sandbox.ts';
import { GIT_SAFE, GITHUB_VAULT, shq } from './tools/coding.ts';
import { cleanHomeUrl, HOME_VAULT } from './tools/home.ts';
import { buildToday, clearTodayCache } from './today.ts';
import { MEMORY_KINDS, parseOnDate, type Memory, type MemoryKind } from './memory.ts';
import { exportAll, importAll } from './export.ts';
import { BACKUPS_DIR, backupName, createBackup, DEFAULT_BACKUP, listBackups } from './backup.ts';
import { type AppInfo, healthReport } from './health.ts';
import { TELEGRAM_VAULT, telegramSettings } from './bridges/telegram.ts';
import { DISCORD_VAULT, botHourlyCapOf, botTurnLimitOf, cleanBotList, discordSettings } from './bridges/discord.ts';
import { cleanDiscordIds, cleanTelegramIds } from './bridges/rules.ts';
import { type LibraryDoc, MAX_DOC_BYTES } from './library/store.ts';
import { embedTarget } from './embeddings.ts';
import { detectKind, SUPPORTED } from './library/read.ts';
import { DEFAULT_VOICE, openaiSpeak, speechText, VOICE_VAULT, VoiceError, type VoiceSettings, xaiSpeak, xaiVoices } from './voice.ts';
import { dayStartUtc, parseWhen, PLACE_DUE, REPEATS, type PlannerStore, type Priority, type Repeat } from './planner.ts';
import { forgetMemory, localDate, memorySettings, summarizeConversation, type MemorySettings } from './memory-worker.ts';
import { mcpSecrets, mergeSecrets, searchConfig } from './integrations.ts';
import { MCP_PRESETS, mcpVaultKey, validateMcpConfig, type McpServerConfig } from './tools/mcp.ts';
import { SEARCH_PROVIDERS, searchVaultKey, type SearchProvider } from './tools/search.ts';
import { gatherStory, lookbacks, STORY_FILTERS, type StoryFilter } from './story.ts';

function validMode(v: unknown): ConversationMode {
  if (!CONVERSATION_MODES.includes(v as ConversationMode)) throw new HttpError(400, 'mode must be chat or coding');
  return v as ConversationMode;
}

function tagsOrThrow(v: unknown): string[] {
  try {
    return cleanTags(v);
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
}

function validWorkspace(v: unknown): string {
  const name = String(v ?? '');
  if (!WORKSPACE_NAME_RE.test(name)) throw new HttpError(400, 'Workspace name: letters, digits, dot, dash, underscore (max 64).');
  return name;
}

export interface ServerOptions {
  app: AppContext;
  auth: OwnerAuth;
  webDir: string;
  /** Version info for the health page. */
  info?: AppInfo;
  /** Send the Secure flag on cookies (set when served over HTTPS / behind a TLS proxy). */
  secureCookies?: boolean;
  /**
   * Trust X-Forwarded-For from a local reverse proxy (SARA_TRUST_PROXY=1). Security review (L7):
   * `{ secret }` trusts it only on requests carrying the X-Sara-Proxy header with that per-install
   * secret (Caddy adds it); `{ secret: '' }` never trusts it (tailscale serve can't add a header),
   * so rate limits count by connection. X-Forwarded-Proto is trusted either way.
   */
  trustProxy?: boolean | { secret: string };
  /** Tests: a fake voice service for live calls. */
  liveConnect?: ConnectUpstream;
  /** Demo server for app review and trying Sara out (SARA_DEMO=1, Phase 16). */
  demo?: boolean;
  /** Tests: where to look for the sara-updater.path unit (default /etc/systemd/system). */
  updaterUnitDir?: string;
  /** Tests: which system's way of updating to use (default: this one's; linux when updaterUnitDir is set). */
  updaterPlatform?: NodeJS.Platform;
  /** Tests: a stand-in for the network when checking for a new release (Windows/macOS). */
  updaterFetch?: typeof fetch;
  /** Demo: messages per day for everyone together (SARA_DEMO_DAILY, default 300). */
  demoDaily?: number;
  /** Demo: the reviewer code that unlocks live calls (SARA_DEMO_CALL_CODE; unset = no calls in the demo). */
  demoCallCode?: string;
  /** Demo: minutes of live calls per day for everyone together (SARA_DEMO_CALL_MINUTES_PER_DAY, default 30). */
  demoCallMinutesPerDay?: number;
  /** Tests: the demo call limits (per call, clock). */
  demoCallPerCallMs?: number;
  /** Accept reports from other Sara servers and apps (the app developer's inbox, Phase 19). */
  reportInbox?: boolean;
  /** Where this server sends reports for the developer (SARA_REPORT_TO; "off" = never). */
  reportTo?: string;
  /** Phase 31: all companions on this server (the app above is one of them). */
  companions?: import('./companions.ts').CompanionManager;
  /** Phase 59: first sign-in in the browser on a new server (src/claim.ts); shared by every companion. */
  claim?: FirstClaim;
}

/** A soft square picture with a companion's initial (until she has a look of her own). */
export function initialPicture(name: string): string {
  const letter = ([...name.trim()][0] ?? '?').toUpperCase().replace(/[<>&"']/g, '?');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,72%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},50%,52%)"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="240" font-weight="600" fill="#fff">${letter}</text></svg>`;
}

/** The cookie (and header) naming the companion the app is talking to. */
export const COMPANION_COOKIE = 'sara_companion';
/** Hardening M4: the channel of the conversations the Home Assistant integration makes. */
export const HA_CHANNEL = 'home-assistant';

/**
 * Phase 31: which companion a request is for. A conversation in the path decides (so links and
 * notifications from any companion open in the right place); otherwise the app's choice, from
 * the x-sara-companion header or the sara_companion cookie; otherwise the first companion.
 */
export function pickCompanion(companions: import('./companions.ts').CompanionManager, req: IncomingMessage): import('./companions.ts').Companion {
  const path = (req.url ?? '/').split('?')[0];
  const conv = /^\/api\/(?:conversations|live)\/([0-9a-f-]{36})(?:\/|$)/.exec(path)?.[1];
  if (conv) {
    const owner = companions.byConversation(conv);
    if (owner) return owner;
  }
  const ring = /^\/api\/calls\/([\w-]{6,64})\/(?:decline|cancel)$/.exec(path)?.[1];
  if (ring) {
    const owner = companions.byRing(ring);
    if (owner) return owner;
  }
  const h = req.headers['x-sara-companion'];
  const want = (Array.isArray(h) ? h[0] : h) || cookies(req)[COMPANION_COOKIE];
  return companions.get(want) ?? companions.main;
}

// Pairing codes: 12 letters/digits without look-alikes (about 59 bits), shown as XXXX-XXXX-XXXX.
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAIR_LEN = 12;
const PAIR_MS = 10 * 60_000;
export function newPairCode(): string {
  let s = '';
  // Rejection sampling keeps every character equally likely.
  while (s.length < PAIR_LEN) for (const b of randomBytes(PAIR_LEN)) if (b < 248 && s.length < PAIR_LEN) s += PAIR_ALPHABET[b % 31];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
/** Typing is forgiving: lower case, spaces and dashes are fine; O→0 and I/L→1 aren't in the alphabet. */
export const normalizePairCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Requests from Sara's phone apps (their web views add "SaraPhone/<n>" to the user agent). */
export const fromPhoneApp = (req: IncomingMessage): boolean => /\bSaraPhone\/\d/.test(String(req.headers['user-agent'] ?? ''));
/** Phase 33: Sara's phone OR desktop apps (adult mode is turned on from a web browser only). */
export const fromSaraApp = (req: IncomingMessage): boolean => /\bSara(Phone|Desktop)\/\d/.test(String(req.headers['user-agent'] ?? ''));

interface ActiveTurn {
  controller: AbortController;
  startedAt: string;
  status: 'thinking' | 'writing' | 'running' | 'waiting';
  detail: string;
  approvals: Map<string, Extract<ChatEvent, { type: 'approval' }>>;
}

class HttpError extends Error {
  readonly status: number;
  /** Extra fields for the JSON error body (e.g. { twoStep: true }). */
  readonly extra?: Record<string, unknown>;
  /**
   * Phase 61: `message` is English. With `extra.params` it is a template ("Send up to {n} photos at a
   * time."): the body then has the filled English `error` plus `errorKey` (the template) and `params`,
   * so the app shows it in the owner's language (web/naming.js serverText). `extra.errorKey` alone
   * names the template of a message the server already personalized.
   */
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    const params = extra?.params && typeof extra.params === 'object' ? (extra.params as Record<string, unknown>) : undefined;
    super(params ? fill(message, params) : message);
    this.status = status;
    if (params) this.extra = { errorKey: message, ...extra };
    else if (extra) this.extra = extra;
  }
}

/** decodeURIComponent that answers a garbled address with 400 instead of a crash report. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new HttpError(400, 'That address is not valid.');
  }
}

const MAX_BODY = 1024 * 1024;
/** A message with up to 4 photos (base64 adds a third). */
const PHOTO_BODY = 48 * 1024 * 1024;
const MAX_IMPORT = 200 * 1024 * 1024;
const MAX_AVATAR = 5 * 1024 * 1024;
/** A character file: the look is ~20 pictures (Phase 21). */
const MAX_CHARACTER = 60 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  // Phase 24: only the microphone (voice notes, calls) and clipboard are used; nothing else.
  'permissions-policy': 'camera=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), microphone=(self), clipboard-write=(self)',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(json);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.cache', 'dist', 'build', '.next']);
/** Files in a folder (newest first), skipping dependency/VCS folders. */
function listFiles(root: string, max: number): { files: { path: string; size: number; modifiedAt: string }[]; truncated: boolean } {
  const out: { path: string; size: number; modifiedAt: string; ms: number }[] = [];
  let truncated = false;
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 6) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= max * 4) {
        truncated = true;
        return;
      }
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) walk(join(dir, d.name), r, depth + 1);
      } else if (d.isFile()) {
        const st = statSync(join(dir, d.name));
        out.push({ path: r, size: st.size, modifiedAt: st.mtime.toISOString(), ms: st.mtimeMs });
      }
    }
  };
  if (existsSync(root)) walk(root, '', 0);
  out.sort((x, y) => y.ms - x.ms);
  if (out.length > max) truncated = true;
  return { files: out.slice(0, max).map(({ ms: _ms, ...f }) => f), truncated };
}

async function readJson(req: IncomingMessage, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Expected application/json');
  if (Number(req.headers['content-length'] ?? 0) > maxBody) throw new HttpError(413, 'Request body too large');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBody) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

async function readRaw(req: IncomingMessage, maxBody: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > maxBody) throw new HttpError(413, 'Request body too large');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBody) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // a garbled cookie is simply ignored
      }
    } catch {
      /* a malformed cookie (e.g. set by another site on the same domain) is skipped */
    }
  }
  return out;
}

/**
 * Client address for rate limiting. Behind a trusted reverse proxy (Apache, nginx, Caddy) the
 * socket address is the proxy, so use the last X-Forwarded-For entry, which the proxy appends.
 * Earlier entries are client-controlled and ignored (see proxyTrust below for when it's trusted).
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean | { secret: string } = false): string {
  return clientIpOf(req, trustProxy);
}

/**
 * Security review (L7): how far to trust a local reverse proxy, from sara.env.
 * - SARA_TRUST_PROXY unset/0: not at all.
 * - A per-install secret (SARA_PROXY_SECRET, or <data>/proxy-secret written by `sara access` for
 *   Caddy): X-Forwarded-For only on requests with the matching X-Sara-Proxy header. Any local
 *   program can connect to 127.0.0.1 and send its own X-Forwarded-For; without the secret it is
 *   counted by its connection like everyone else.
 * - Tailscale (SARA_ACCESS=tailscale): `tailscale serve` can't add a header, so never.
 * - Otherwise (a reverse proxy the owner set up by hand: Apache, nginx): as before.
 */
export function proxyTrust(env: NodeJS.ProcessEnv, dataDir: string): boolean | { secret: string } {
  if (env.SARA_TRUST_PROXY !== '1') return false;
  let secret = (env.SARA_PROXY_SECRET ?? '').trim();
  if (!secret) {
    try {
      secret = readFileSync(join(dataDir, 'proxy-secret'), 'utf8').trim();
    } catch {
      secret = '';
    }
  }
  if (secret) return { secret };
  if (env.SARA_ACCESS === 'tailscale' || env.SARA_MAC_TS_SERVE === '1') return { secret: '' };
  return true;
}

function clientIpOf(req: IncomingMessage, trustProxy: boolean | { secret: string }): string {
  const socketIp = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy) return socketIp;
  if (typeof trustProxy === 'object') {
    const given = req.headers['x-sara-proxy'];
    const a = Buffer.from(typeof given === 'string' ? given : '');
    const b = Buffer.from(trustProxy.secret);
    if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) return socketIp;
  }
  const xff = req.headers['x-forwarded-for'];
  const value = Array.isArray(xff) ? xff.join(',') : xff;
  const last = value?.split(',').map((s) => s.trim()).filter(Boolean).at(-1);
  return last || socketIp;
}

export function createSaraServer(opts: ServerOptions): Server {
  const { app, auth } = opts;
  const limiter = new LoginLimiter();
  // Device-code start/poll get their own budget: an app (or a flood of them) can't lock the owner
  // out of signing in, and sign-in failures don't block apps.
  const deviceLimiter = new LoginLimiter(20);
  const active = new Map<string, ActiveTurn>();
  app.isBusy = (id) => active.has(id);
  const webRoot = resolve(opts.webDir);
  // Built-in wording names the owner's companion (written for "Sara"/she, see identity.ts).
  const me = (t: string) => personalize(t, identityOf(app.persona));
  // Her voice and hearing (Grok voice key or sign-in, speech APIs, the on-server voice).
  const speech = speechOf(app);
  const grokSignedIn = () => speech.grokSignedIn();
  const xaiKeySync = () => speech.xaiKeySync();
  const xaiKey = () => speech.xaiKey();
  /** Phase 48: live calls: which voice service, how it's paid for, or why there's none. */
  const liveView = () => {
    const c = speech.liveChoice();
    return c.engine ? { available: true, engine: c.engine, how: c.how, billedTo: c.billedTo, setting: speech.settings().live ?? 'auto' } : { available: false, engine: null, how: null, message: c.message, setting: speech.settings().live ?? 'auto' };
  };
  const openaiLiveKeyInfo = () => {
    const k = speech.openaiRealtimeKey();
    return k ? { source: k.source, ...(k.provider ? { provider: k.provider } : {}) } : null;
  };
  // Phase 11: one live call at a time.
  let liveCall: LiveCall | undefined;
  // Phase 26: Sara calls you (rings every signed-in app; the first to answer gets the call).
  app.calls ??= new CallBroker(app, { canCall: () => speech.hasXai(), canSpeak: () => speech.canSendNotes() || ((app.settings.get().voice?.tts ?? 'local') === 'local' && Boolean(app.voice)) });
  app.calls.setInCall(() => Boolean(liveCall && !liveCall.ended));
  // identity.ts is shared with the browser: served with its types stripped (no build step).
  let identityJs: string | undefined;

  // Secure when configured, or (Phase 24) whenever the page is served over https: directly, or
  // through a trusted reverse proxy that says so.
  const isHttps = (req: IncomingMessage) => Boolean((req.socket as { encrypted?: boolean }).encrypted) || (Boolean(opts.trustProxy) && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https');
  const cookieFor = (req: IncomingMessage) => (value: string, maxAge: number) =>
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${opts.secureCookies || isHttps(req) ? '; Secure' : ''}`;

  function isAuthed(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    // Phase 52: an app the owner approved with a device code (it was approved while signed in, so
    // it works with two-step sign-in on too; signing it out under Devices ends it).
    if (header?.startsWith(`Bearer ${DEVICE_TOKEN_PREFIX}`)) {
      // Phase 57: an API key for another app only works on /v1 and /mcp, never on the app's own API.
      const id = opts.demo ? undefined : auth.deviceTokenId(header.slice(7));
      return id !== undefined && auth.deviceKind(id) !== 'api';
    }
    // Phase 24: with two-step sign-in on, the owner token alone is no longer enough.
    if (header?.startsWith('Bearer ')) {
      const ok = !auth.twoStepOn && auth.verifyToken(header.slice(7));
      // Phase 59: the owner token was used, so the server has its owner: browser setup ends.
      if (ok) auth.markSignedIn();
      return ok;
    }
    return auth.verifySession(cookies(req)[SESSION_COOKIE]);
  }

  function providerView() {
    const s = app.settings.get();
    return {
      presets: PROVIDER_PRESETS,
      // Phase 56: each provider's model list (checked when, its options).
      providers: s.providers.map((p) => ({ ...p, hasKey: app.vault.has(vaultKeyFor(p.id)), ...(app.modelCatalog ? { modelList: { checkedAt: app.modelCatalog.view(p.id).checkedAt, options: app.modelCatalog.options(p.id) } } : {}) })),
      defaultProviderId: s.defaultProviderId ?? null,
      defaultModel: s.defaultModel ?? null,
    };
  }

  /** The owner's own picture for her, if uploaded (data dir, never the repo). */
  function avatarFile(): string | undefined {
    for (const ext of Object.keys(AVATAR_TYPES)) {
      const f = join(app.dataDir, `avatar.${ext}`);
      if (existsSync(f)) return f;
    }
    return undefined;
  }

  function projectOrThrow(raw: unknown) {
    const id = Number(raw);
    const p = app.planner?.projects(true).find((x) => x.id === id);
    if (!p) throw new HttpError(400, 'That project does not exist.');
    return p;
  }

  function savePhotos(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new HttpError(400, 'images must be a list.');
    if (raw.length > MAX_IMAGES_PER_MESSAGE) throw new HttpError(400, 'Send up to {n} photos at a time.', { params: { n: MAX_IMAGES_PER_MESSAGE } });
    if (raw.length && !app.uploads) throw new HttpError(400, 'Photos are not available on this server.');
    try {
      return raw.map((d) => app.uploads!.save(String(d)).id);
    } catch (err) {
      if (err instanceof UploadError) throw new HttpError(400, err.message);
      throw err;
    }
  }

  function requireDisclosure(req: IncomingMessage): void {
    if (opts.demo ? !demoAccepted.has(visitorKey(req)) : !app.settings.get().disclosureAcceptedAt) throw new HttpError(403, 'Accept the disclosure first.');
  }

  // ---------- Demo server (Phase 16, SARA_DEMO=1) ----------
  // For app review and trying Sara out. Every visitor gets their own conversations, kept only in
  // memory (off the record: never on disk, no memory, no tools) and gone after a few idle hours.
  // Settings and everything else that changes the server are refused. Each visitor accepts the
  // AI disclosure themselves. Daily message limits keep the model bill small.
  const DEMO_IDLE_MS = 6 * 3600_000;
  const DEMO_TURNS_PER_VISITOR = 40;
  const DEMO_TURNS_PER_DAY = opts.demoDaily ?? 300;
  const demoAccepted = new Set<string>();
  const demoOwner = new Map<string, string>(); // conversation id → visitor
  const demoTurns = new Map<string, number>();
  let demoDay = '';
  let demoTotal = 0;
  // Live calls in the demo, for app review: only with the reviewer code, 5 minutes a call, and a
  // daily budget of minutes for everyone together.
  const demoCalls = new DemoCallGate({ code: opts.demo ? opts.demoCallCode : undefined, ...(opts.demoCallMinutesPerDay !== undefined ? { minutesPerDay: opts.demoCallMinutesPerDay } : {}), ...(opts.demoCallPerCallMs !== undefined ? { perCallMs: opts.demoCallPerCallMs } : {}), now: Date.now });
  if (demoCalls.refused) console.warn(`demo calls: ${demoCalls.refused}`);
  /** Who is asking: the signed-in device (cookie), or the owner token. */
  const visitorKey = (req: IncomingMessage): string => auth.sessionId(cookies(req)[SESSION_COOKIE]) ?? 'token';
  function demoTurnAllowed(req: IncomingMessage): void {
    if (!opts.demo) return;
    const day = new Date().toISOString().slice(0, 10);
    if (day !== demoDay) {
      demoDay = day;
      demoTotal = 0;
      demoTurns.clear();
    }
    const k = visitorKey(req);
    const n = demoTurns.get(k) ?? 0;
    if (n >= DEMO_TURNS_PER_VISITOR || demoTotal >= DEMO_TURNS_PER_DAY) throw new HttpError(429, 'That’s all for the demo today. Install Sara on your own server for unlimited use.');
    demoTurns.set(k, n + 1);
    demoTotal++;
  }
  /** What a demo visitor may change: their own conversations, signing out. Everything else is read-only. */
  const DEMO_WRITES = new Set(['conversations', 'disclosure', 'logout', 'demo', 'reports']);
  /** Security review: routes an app signed in with a device code may not use (sign-in settings, devices, approving apps). */
  const DEVICE_TOKEN_DENIED = new Set(['devices', 'device', 'security', 'passkey', 'two-step', 'owner-token', 'pair', 'other-apps']);
  /**
   * Phase 24 (security review): what a demo visitor may read. Everyone on the demo is "signed in",
   * so owner-only pages (backups, files, health details, accounts, devices…) must be listed out,
   * not left open.
   */
  const DEMO_READS = new Set(['live', 'session', 'conversations', 'events', 'persona', 'look', 'sara', 'memories', 'memory', 'projects', 'tasks', 'notes', 'reminders', 'planner', 'scrapbook', 'today', 'tags', 'find', 'approvals', 'jobs', 'setup', 'checklist', 'review', 'briefing', 'providers', 'tools', 'settings', 'uploads', 'reports', 'identity']);
  if (opts.demo) {
    setInterval(() => {
      const cutoff = Date.now() - DEMO_IDLE_MS;
      for (const c of offStore.listConversations()) if (Date.parse(c.updatedAt) < cutoff && !active.has(c.id)) (offStore.deleteConversation(c.id), demoOwner.delete(c.id));
      // Demo sign-ins last a day.
      for (const d of auth.devices()) {
        if (Date.parse(d.createdAt) >= Date.now() - 24 * 3600_000) continue;
        auth.signOut(d.id);
        // Hardening L3: the reviewer-code unlock (and the accepted notice) end with the session.
        demoCalls.forget(d.id);
        demoAccepted.delete(d.id);
      }
      prunePush();
    }, 10 * 60_000).unref();
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/identity.js') {
      identityJs ??= stripTypeScriptTypes(readFileSync(join(webRoot, '..', 'src', 'identity.ts'), 'utf8'));
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
      return void res.end(req.method === 'HEAD' ? undefined : identityJs);
    }
    if (pathname === '/manifest.webmanifest') {
      // The installed app is named after the companion (only for the signed-in owner).
      const m = JSON.parse(readFileSync(join(webRoot, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
      if (isAuthed(req)) m.name = m.short_name = app.persona.name;
      res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
      return void res.end(req.method === 'HEAD' ? undefined : JSON.stringify(m));
    }
    const rel = pathname === '/' ? 'index.html' : pathname === '/pair' ? 'pair.html' : pathname === '/device' ? 'device.html' : pathname === '/privacy' ? 'privacy.html' : pathname === '/support' ? 'support.html' : pathname === '/help' ? 'help.html' : safeDecode(pathname).replace(/^\/+/, '');
    // Phase 31: a companion without a look of her own yet shows her initial, not Sara's face.
    if (app.companionId && app.companionId !== 'main' && isAuthed(req) && !app.look?.custom && /^(sara-portrait|sara-avatar)\.jpg$|^sara\/[\w-]+\.jpg$/.test(rel)) {
      const svg = initialPicture(app.persona.name);
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
      return void res.end(req.method === 'HEAD' ? undefined : svg);
    }
    // A custom look replaces the built-in art for the signed-in owner.
    const custom = isAuthed(req) ? app.look?.fileFor(rel) : undefined;
    if (!custom && isAuthed(req) && app.look?.missing(rel)) throw new HttpError(404, 'Not found');
    if (custom) {
      const cs = statSync(custom);
      const ctag = `"l${cs.size.toString(36)}-${Math.floor(cs.mtimeMs).toString(36)}"`;
      if (req.headers['if-none-match'] === ctag) {
        res.writeHead(304, { etag: ctag, 'cache-control': 'no-cache', ...SECURITY_HEADERS });
        return void res.end();
      }
      const head = readFileSync(custom).subarray(0, 4);
      res.writeHead(200, { 'content-type': head[0] === 0x89 ? 'image/png' : head[0] === 0x52 ? 'image/webp' : 'image/jpeg', 'cache-control': 'no-cache', etag: ctag, ...SECURITY_HEADERS });
      if (req.method === 'HEAD') return void res.end();
      return void createReadStream(custom).pipe(res);
    }
    const file = resolve(webRoot, normalize(rel));
    if (file !== webRoot && !file.startsWith(webRoot + sep)) throw new HttpError(404, 'Not found');
    const target = existsSync(file) && statSync(file).isFile() ? file : join(webRoot, 'index.html');
    const st = statSync(target);
    // Always revalidate so a new version is picked up on the next load; unchanged files cost a 304.
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-cache', ...SECURITY_HEADERS });
      return void res.end();
    }
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      etag,
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(target).pipe(res);
  }

  /**
   * Runs a turn. The turn keeps going if the browser disconnects (reload, closed tab); only the
   * Stop endpoint cancels it. Progress is visible through `activity` on the conversation.
   */
  /**
   * Runs one turn with activity tracking (busy state, activity bar, approvals, Stop). Used by the
   * web stream and by the chat bridges (Telegram, Discord) via app.runTracked.
   */
  // Off the record (Phase 14): conversations kept only in this process's memory. Nothing is
  // written to disk (so nothing reaches backups); no memory notes, no mood changes, no tools (they
  // could leave files), no photos. Closing it, or a server restart, makes it gone for good.
  // The safety layer (disclosure, crisis help, the minor block) works exactly as usual.
  class OffRecordStore extends Store {
    // How long she's known the owner still comes from the real history.
    override firstOwnerMessageAt() {
      return app.store.firstOwnerMessageAt();
    }
  }
  const offStore = new OffRecordStore(':memory:', app.now);
  const noTools = new ToolRegistry([]);
  // Demo: every visitor's conversations share this store, so what she reads through her context
  // ("lately in your other conversations") must never list them: another visitor's chat would
  // reach her chat or call. The demo's own routes use offStore directly and filter by visitor.
  const ctxStore: OffRecordStore = opts.demo
    ? new Proxy(offStore, {
        get: (t, k) => {
          if (k === 'listConversations') return () => [];
          const v = Reflect.get(t, k, t) as unknown;
          return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(t) : v;
        },
      })
    : offStore;
  const offOverrides: Partial<AppContext> = { store: ctxStore, memory: undefined, inner: undefined, tools: noTools, uploads: undefined, together: app.together ? new TogetherStore(offStore.db, app.now) : undefined };
  const offApp = new Proxy(app, { get: (t, k: string) => (k in offOverrides ? offOverrides[k as keyof AppContext] : t[k as keyof AppContext]) }) as AppContext;
  /** The context a conversation lives in (off-the-record ones are only in memory). */
  const ctxOf = (id: string): AppContext => (offStore.getConversation(id) ? offApp : app);

  async function runTracked(conversationId: string, content: string, onEvent: (ev: ChatEvent) => void, opts: TurnOptions = {}): Promise<void> {
    if (active.has(conversationId)) throw new HttpError(409, me('Sara is still working on this conversation. Wait for her or press Stop.'), { errorKey: 'Sara is still working on this conversation. Wait for her or press Stop.' });
    const controller = new AbortController();
    const turn: ActiveTurn = { controller, startedAt: app.now().toISOString(), status: 'thinking', detail: '', approvals: new Map() };
    active.set(conversationId, turn);
    let lastText = '';
    let failed = false;
    const cx = ctxOf(conversationId);
    // Other devices showing this conversation follow along (never for off-the-record ones).
    const shared = cx === app;
    if (shared) app.events?.publish({ type: 'turn', conversationId, state: 'started' });
    const partner = Boolean(cx.store.getConversation(conversationId)?.partner);
    const started = Date.now();
    let firstToken = 0;
    try {
      for await (const ev of runTurn(cx, conversationId, content, controller.signal, opts)) {
        trackActivity(turn, ev);
        onEvent(ev);
        // Phase 30: how long until her reply starts (health history).
        if (ev.type === 'token' && !firstToken) firstToken = Date.now() - started;
        if (ev.type === 'token') lastText += ev.text;
        if (ev.type === 'tool_call' || ev.type === 'tool_result') lastText = '';
        if (ev.type === 'error') failed = true;
        // She needs the owner's OK: a notification (shown only when the app isn't in front).
        if (ev.type === 'approval' && !partner) void app.push?.notifyOwner(trOwner('Sara needs your OK', app.settings.get(), undefined, identityOf(app.persona)), ev.summary, conversationId, `ok-${ev.id}`).catch(() => {});
      }
      // A long job finished while the owner may be away.
      const secs = (app.now().getTime() - Date.parse(turn.startedAt)) / 1000;
      if (!partner && !failed && !controller.signal.aborted && secs >= 60) void app.push?.notifyOwner(trOwner('Sara finished', app.settings.get(), undefined, identityOf(app.persona)), lastText.trim() || trOwner('Done.', app.settings.get()), conversationId, `done-${conversationId}`).catch(() => {});
      app.healthHistory?.turn(firstToken || null, failed);
    } finally {
      active.delete(conversationId);
      // Phase 49: her testing browser closes with the turn.
      void app.browsers?.close(conversationId).catch(() => {});
      if (shared) app.events?.publish({ type: 'turn', conversationId, state: 'ended' });
    }
  }
  app.runTracked = runTracked;
  // Planned shutdown (restart, update): stop running turns so they save what they have.
  app.stopAllTurns = async () => {
    for (const t of active.values()) t.controller.abort(new Error('restart'));
    for (let i = 0; i < 40 && active.size; i++) await new Promise((r) => setTimeout(r, 50));
  };

  // Phase 57: a change another app asked for (an MCP write tool) that needs the owner's OK: an
  // approval card in that app's conversation, like her own actions. It runs only after Allow, and
  // what happened is posted there (and fed to her as an app note).
  const externalTurns = new Map<string, number>();
  function requestApproval(conversationId: string, name: string, summary: string, args: Record<string, unknown>, run: () => Promise<string>): void {
    let turn = active.get(conversationId);
    if (turn && !externalTurns.has(conversationId)) throw new Error(me('Sara is busy in that conversation: try again when she has answered.'));
    if (!turn) {
      turn = { controller: new AbortController(), startedAt: app.now().toISOString(), status: 'waiting', detail: summary, approvals: new Map() };
      active.set(conversationId, turn);
      externalTurns.set(conversationId, 0);
      app.events?.publish({ type: 'turn', conversationId, state: 'started' });
    }
    if (turn.approvals.size >= 10) throw new Error('Ten changes are already waiting for the owner there.');
    const t = turn;
    const { id, decision } = app.approvals.request(conversationId, t.controller.signal);
    const callId = `app-${id}`;
    t.approvals.set(callId, { type: 'approval', approvalId: id, id: callId, name, summary, args });
    t.status = 'waiting';
    t.detail = summary;
    externalTurns.set(conversationId, (externalTurns.get(conversationId) ?? 0) + 1);
    void app.push?.notifyOwner(trOwner('Sara needs your OK', app.settings.get(), undefined, identityOf(app.persona)), summary, conversationId, `ok-${id}`).catch(() => {});
    void decision
      .then(async (ok) => {
        let text: string;
        let status = ok ? 'ok' : 'stopped';
        try {
          text = ok ? await run() : `Declined: ${summary}`;
        } catch (err) {
          text = `Couldn't do it (${summary}): ${(err as Error).message}`;
          status = 'error';
        }
        const msg = app.store.addMessage(conversationId, 'notice', `job:${text}`, { status });
        app.events?.publish({ type: 'message', conversationId, message: { id: msg.id, role: msg.role, content: msg.content, createdAt: msg.createdAt, meta: { status } }, reason: 'job' });
      })
      .finally(() => {
        t.approvals.delete(callId);
        const n = (externalTurns.get(conversationId) ?? 1) - 1;
        if (n > 0) return void externalTurns.set(conversationId, n);
        externalTurns.delete(conversationId);
        if (active.get(conversationId) === t) active.delete(conversationId);
        app.events?.publish({ type: 'turn', conversationId, state: 'ended' });
      });
  }
  // Phase 57: other apps (OpenAI-compatible /v1, MCP /mcp): per-key limits.
  const appLimiter = new KeyLimiter(60);
  // Phase 57: character cards being previewed (in memory, 15 minutes, up to 5).
  const cardDrafts = new Map<string, { imp: CardImport; png: Buffer | undefined; expires: number }>();

  /** Runs a turn with nobody streaming it; her reply is published as a message (→ notifications). */
  async function runBackground(conversationId: string, content: string, opts: TurnOptions = {}): Promise<void> {
    const cx = ctxOf(conversationId);
    let replyId = 0;
    try {
      await runTracked(conversationId, content, (ev) => {
        if (ev.type === 'done') replyId = ev.messageId;
      }, opts);
    } catch (err) {
      console.warn(`background reply: ${(err as Error).message}`);
      return;
    }
    const msg = replyId ? cx.store.messages(conversationId).find((m) => m.id === replyId) : undefined;
    if (!msg || msg.role !== 'assistant' || !msg.content.trim() || cx !== app) return;
    // Marked so the Android app's regular check shows it too.
    app.store.updateMessageMeta(msg.id, { background: true });
    app.events?.publish({ type: 'message', conversationId, message: { id: msg.id, role: msg.role, content: msg.content, createdAt: msg.createdAt, meta: { ...(msg.meta ?? {}), background: true } }, reason: 'reply' });
  }

  async function streamChat(req: IncomingMessage, res: ServerResponse, conversationId: string, content: string, opts: TurnOptions = {}): Promise<void> {
    if (active.has(conversationId)) throw new HttpError(409, me('Sara is still working on this conversation. Wait for her or press Stop.'), { errorKey: 'Sara is still working on this conversation. Wait for her or press Stop.' });
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      ...SECURITY_HEADERS,
    });
    const write = (chunk: string) => {
      if (!res.destroyed && !res.writableEnded) res.write(chunk);
    };
    // Heartbeat keeps proxies from timing out during long tool runs.
    const heartbeat = setInterval(() => write(': ping\n\n'), 15_000);
    try {
      await runTracked(conversationId, content, (ev) => write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`), opts);
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }

  function trackActivity(turn: ActiveTurn, ev: ChatEvent): void {
    switch (ev.type) {
      case 'token':
        turn.status = 'writing';
        turn.detail = '';
        break;
      case 'tool_call':
        turn.status = 'running';
        turn.detail = ev.summary;
        break;
      case 'tool_progress':
        turn.status = 'writing';
        turn.detail = ev.path ? `writing ${ev.path} (${Math.round(ev.chars / 1024)} KB so far)` : `preparing ${ev.name} (${Math.round(ev.chars / 1024)} KB so far)`;
        break;
      case 'tool_building':
        // Phase 63: a call still being written (another device watching sees what).
        turn.status = 'writing';
        turn.detail = ev.path ? `writing ${ev.path}${ev.lines ? ` (${ev.lines} lines so far)` : ''}` : `preparing ${ev.name}`;
        break;
      case 'approval':
        turn.status = 'waiting';
        turn.detail = ev.summary;
        turn.approvals.set(ev.id, ev);
        break;
      case 'tool_running':
        turn.approvals.delete(ev.id);
        turn.status = 'running';
        turn.detail = ev.summary;
        break;
      case 'tool_result':
        turn.approvals.delete(ev.id);
        turn.status = 'thinking';
        turn.detail = '';
        break;
    }
  }

  function needPlanner(): PlannerStore {
    if (!app.planner) throw new HttpError(404, 'Planner is not available');
    return app.planner;
  }

  function whenOrNull(v: unknown, dateOnlyHour?: number): string | null {
    if (v === undefined || v === null || v === '') return null;
    const d = parseWhen(String(v), app.now(), app.settings.get().timeZone, { dateOnlyHour });
    if (!d) throw new HttpError(400, 'Couldn\'t understand the time "{time}"', { params: { time: String(v) } });
    return d.toISOString();
  }

  function validPriority(v: unknown): Priority | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    if (!['low', 'normal', 'high'].includes(String(v))) throw new HttpError(400, 'priority must be low, normal or high');
    return v as Priority;
  }

  /** Push channel: reminders, proactive messages, planner/memory changes. */
  function streamEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive', ...SECURITY_HEADERS });
    res.write(': connected\n\n');
    const write = (chunk: string) => {
      if (!res.destroyed && !res.writableEnded) res.write(chunk);
    };
    const me = app.companionId ?? 'main';
    const off = app.events?.subscribeAll((ev) => {
      // Phase 31: another companion's message or call shows as a notice (switch to her to see it).
      if (ev.companion && ev.companion !== me && ev.type !== 'planner') {
        if (ev.type !== 'message' && ev.type !== 'ring') return;
        const other = opts.companions?.get(ev.companion);
        if (!other) return;
        const note = { companion: ev.companion, name: other.app.persona.name, kind: ev.type, ...(ev.type === 'ring' ? { ring: ev.ring } : { conversationId: ev.conversationId, messageId: ev.message.id, role: ev.message.role, preview: ev.message.role === 'assistant' ? other.app.redactor.redact(ev.message.content).slice(0, 140) : '' }) };
        return write(`event: other\ndata: ${JSON.stringify(note)}\n\n`);
      }
      const out = ev.type === 'message' ? { ...ev, message: { ...ev.message, ...(ev.message.meta ? { meta: app.redactor.redactValue(ev.message.meta) } : {}) } } : ev;
      write(`event: ${ev.type}\ndata: ${JSON.stringify(out)}\n\n`);
    });
    const heartbeat = setInterval(() => write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      off?.();
    });
  }

  function activityView(conversationId: string) {
    const t = active.get(conversationId);
    return t ? { status: t.status, detail: t.detail, startedAt: t.startedAt, approvals: [...t.approvals.values()] } : null;
  }

  let pairing: { hash: Buffer; expires: number } | undefined;
  // Phase 52: device-code sign-in requests (in memory, 10 minutes).
  const deviceFlow = new DeviceFlow();
  /** The device id when the request came with a device token (apps can't approve other apps). */
  const deviceTokenOf = (req: IncomingMessage) => {
    const h = req.headers.authorization;
    return h?.startsWith(`Bearer ${DEVICE_TOKEN_PREFIX}`) ? auth.deviceTokenId(h.slice(7)) : undefined;
  };
  // Phase 24: passkey challenges (one use, 5 minutes).
  const challenges = new Map<string, { purpose: 'signin' | 'register' | 'confirm'; expires: number }>();
  const issueChallenge = (purpose: 'signin' | 'register' | 'confirm') => {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
    // Separate room for sign-in and for adding passkeys, so a flood of one can't block the other.
    if ([...challenges.values()].filter((v) => v.purpose === purpose).length >= 200) throw new HttpError(429, 'Too many passkey requests. Try again in a few minutes.');
    const c = newChallenge();
    challenges.set(c, { purpose, expires: now + 5 * 60_000 });
    return c;
  };
  const takeChallenge = (c: string, purpose: 'signin' | 'register' | 'confirm'): string => {
    const v = challenges.get(c);
    challenges.delete(c);
    if (!v || v.purpose !== purpose || v.expires < Date.now()) throw new Error('This passkey request has expired. Try again.');
    return c;
  };
  const clientChallenge = (clientDataJSON: unknown): string => {
    try {
      return String((JSON.parse(Buffer.from(String(clientDataJSON ?? ''), 'base64url').toString('utf8')) as { challenge?: string }).challenge ?? '');
    } catch {
      return '';
    }
  };
  /** The site a passkey belongs to: the page's own origin (which must be this server). */
  const passkeySite = (req: IncomingMessage): { origin: string; rpId: string } => {
    const origin = String(req.headers.origin ?? '');
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      throw new HttpError(400, 'Passkeys work from the web page only.');
    }
    if (u.host !== req.headers.host) throw new HttpError(403, 'Cross-origin request refused.');
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new HttpError(400, 'Passkeys need a secure (https) address.');
    return { origin: u.origin, rpId: u.hostname };
  };
  // Phase 23: updates from Settings.
  // Phase 31: the server's own folder (each companion's app.dataDir is her own folder).
  const rootDir = app.rootDir ?? app.dataDir;
  const updater = new Updater({ dataDir: rootDir, version: opts.info?.version ?? 'dev', platform: opts.updaterPlatform ?? (opts.updaterUnitDir ? 'linux' : process.platform), ...(opts.updaterFetch ? { fetch: opts.updaterFetch } : {}), ...(opts.updaterUnitDir ? { unitDir: opts.updaterUnitDir, statusDir: rootDir } : {}) });
  const info = opts.info ?? { version: 'dev', revision: null, startedAt: new Date().toISOString() };
  /** After sign-outs: notifications stop for devices that are no longer signed in. */
  const prunePush = () => app.push?.prune(new Set(auth.devices().map((d) => d.id)));

  /**
   * Hardening M4: what the Home Assistant integration's token may do (it asked for this scope when it
   * signed in). Only: who she is, accept the AI notice, list companions, and talk in the conversations
   * this token made itself (channel 'home-assistant', key `<device id>:…`): list them, make one, rename
   * one, read it, send a message, decline her approvals there. Nothing else: no other conversation, no
   * memories, files, settings or devices. Her turns run without her tools unless the owner lets other
   * apps use them (Settings → Connections → Other apps), and with the external-app memory rule (M3).
   */
  async function homeAssistantApi(req: IncomingMessage, res: ServerResponse, method: string, parts: string[], deviceId: string): Promise<void> {
    const [a, b, c] = parts;
    const prefix = `${deviceId}:`;
    const own = (id: string) => {
      const conv = app.store.getConversation(id);
      return conv && conv.channel === HA_CHANNEL && String(conv.channelKey ?? '').startsWith(prefix) ? conv : undefined;
    };
    const mine = () => app.store.listConversations().filter((x) => x.channel === HA_CHANNEL && String(x.channelKey ?? '').startsWith(prefix));
    const turnOpts = (): TurnOptions => ({ noTools: !otherAppsSettings(app.settings.get()).tools, externalApp: true });
    if (a === 'device' && b === 'whoami' && method === 'GET') {
      const d = auth.devices().find((x) => x.id === deviceId);
      return send(res, 200, { companion: app.persona.name, device: d ? { id: d.id, label: d.label, scope: 'home-assistant' } : null, disclosureAccepted: Boolean(app.settings.get().disclosureAcceptedAt), disclosure: disclosureText(app.persona.name, appLanguage(app.settings.get())) });
    }
    if (a === 'device' && b === 'logout' && method === 'POST') {
      auth.signOut(deviceId);
      prunePush();
      return send(res, 200, { ok: true });
    }
    if (a === 'disclosure' && b === 'accept' && method === 'POST') {
      app.settings.update({ disclosureAcceptedAt: app.now().toISOString() });
      return send(res, 200, { ok: true });
    }
    if (a === 'companions' && !b && method === 'GET' && opts.companions) {
      // Names only (no pictures or settings).
      return send(res, 200, { companions: opts.companions.view(app.companionId ?? 'main').map((x) => ({ id: x.id, name: x.name, main: x.main })) });
    }
    if (a === 'conversations' && !b && method === 'GET') return send(res, 200, mine().map((x) => ({ ...x, working: active.has(x.id) })));
    if (a === 'conversations' && !b && method === 'POST') {
      await readJson(req);
      if (mine().length >= 500) throw new HttpError(429, 'Home Assistant has made 500 conversations: delete some in Sara first.');
      return send(res, 201, app.store.createConversation({ title: 'Home Assistant', channel: HA_CHANNEL, channelKey: `${prefix}${randomBytes(6).toString('base64url')}` }));
    }
    if (a === 'conversations' && b) {
      const conv = own(b);
      if (!conv) throw new HttpError(404, 'Conversation not found');
      if (!c && method === 'PATCH') {
        const body = await readJson(req);
        return send(res, 200, app.store.updateConversation(b, body.title !== undefined ? { title: String(body.title).slice(0, 120) } : {}));
      }
      if (c === 'messages' && !parts[3] && method === 'GET') {
        const sp = new URL(req.url ?? '/', 'http://x').searchParams;
        const page = app.store.messagesPage(b, { limit: Math.min(200, Math.max(1, Number(sp.get('limit')) || 50)) });
        return send(res, 200, { messages: page.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })), earlier: page.earlier });
      }
      if (c === 'messages' && !parts[3] && method === 'POST') {
        requireDisclosure(req);
        const body = await readJson(req);
        const content = String(body.content ?? '').trim();
        if (!content) throw new HttpError(400, 'Message is empty');
        if (content.length > 100_000) throw new HttpError(413, 'Message too long');
        if (body.background === true) {
          if (active.has(b)) throw new HttpError(409, me('Sara is still working on this conversation. Wait for her or press Stop.'), { errorKey: 'Sara is still working on this conversation. Wait for her or press Stop.' });
          void runBackground(b, content, turnOpts());
          return send(res, 202, { ok: true });
        }
        return streamChat(req, res, b, content, turnOpts());
      }
    }
    // Declining what she asked for in its own conversations (approving is for the owner, in Sara).
    if (a === 'approvals' && b && method === 'POST') {
      const body = await readJson(req);
      if (body.approved !== false) throw new HttpError(403, 'Approve her actions in Sara itself.');
      if (!mine().some((x) => app.approvals.pendingFor(x.id).includes(b)) || !app.approvals.decide(b, false)) throw new HttpError(404, 'That request is no longer waiting.');
      return send(res, 200, { ok: true });
    }
    throw new HttpError(403, 'Home Assistant can only talk with her in its own conversations.');
  }

  async function api(req: IncomingMessage, res: ServerResponse, method: string, parts: string[]): Promise<void> {
    const [a, b, c] = parts;
    const cookie = cookieFor(req);
    /** For routes that run before the sign-in check: a JSON request from this site only. */
    const sameSiteOnly = () => {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Expected application/json');
      const o = req.headers.origin;
      if (o) {
        let h = '';
        try {
          h = new URL(o).host;
        } catch {
          /* "null" */
        }
        if (h !== req.headers.host) throw new HttpError(403, 'Cross-origin request refused.');
      }
    };

    if (a === 'health' && !b && method === 'GET') return send(res, 200, { ok: true });
    // The developer's report inbox: open to every Sara server and app, but small and rate-limited.
    if (a === 'public' && b === 'report' && method === 'POST' && opts.reportInbox && app.reports) {
      const body = await readJson(req, 16 * 1024);
      try {
        if (!app.reports.receive(clientIp(req, opts.trustProxy), body)) throw new HttpError(429, 'Too many reports from here. Try again later.');
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, (err as Error).message);
      }
      return send(res, 202, { ok: true });
    }

    // Phase 52: device-code sign-in for the terminal client and the VS Code extension. The app
    // asks for a code (counted like a cheap sign-in attempt) and polls with its secret.
    if (a === 'device' && (b === 'start' || b === 'poll') && method === 'POST' && !opts.demo) {
      sameSiteOnly();
      const ip = clientIp(req, opts.trustProxy);
      if (deviceLimiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      const body = await readJson(req);
      if (b === 'start') {
        deviceLimiter.fail(ip, Date.now(), 1);
        let r;
        try {
          // Hardening M4: an app may ask for less than full access (Home Assistant asks for its own scope).
          r = deviceFlow.start(body.name, deviceLabel(req.headers['user-agent']), ip, cleanScope(body.scope));
        } catch (err) {
          throw new HttpError(429, (err as Error).message);
        }
        const origin = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
        app.events?.publish({ type: 'device', pending: deviceFlow.pending().length });
        // Security review: no code in the link: the owner types the code the app shows.
        return send(res, 200, { ...r, verifyUrl: `${origin}/device`, approveIn: 'Settings → Data & health → Devices and sign-in' });
      }
      const r = deviceFlow.poll(String(body.pollToken ?? ''));
      if (r.status === 'expired') deviceLimiter.fail(ip, Date.now(), 0.2);
      return send(res, r.status === 'expired' ? 410 : 200, r.status === 'approved' ? { status: 'approved', token: r.token, deviceId: r.deviceId } : { status: r.status });
    }

    if (a === 'login' && method === 'POST') {
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      const body = await readJson(req);
      if (!auth.verifyToken(String(body.token ?? ''))) {
        limiter.fail(ip);
        throw new HttpError(401, 'Wrong owner token.');
      }
      // Phase 24: two-step sign-in asks for the code from the authenticator app too.
      if (auth.twoStepOn) {
        if (!body.code) throw new HttpError(401, 'Enter the 6-digit code from your authenticator app.', { twoStep: true });
        if (!auth.checkTwoStep(String(body.code))) {
          limiter.fail(ip);
          throw new HttpError(401, 'That code is wrong or was already used. Wait for the next one.', { twoStep: true });
        }
      }
      limiter.reset(ip);
      // Phase 59: the owner has signed in: browser setup (src/claim.ts) closes for good.
      auth.markSignedIn();
      const session = auth.createSession(deviceLabel(req.headers['user-agent']));
      res.setHeader('set-cookie', cookie(session.value, session.maxAgeSeconds));
      // The token has been used: the copy kept for the installer to show isn't needed any more.
      rmSync(join(app.dataDir, 'first-token.txt'), { force: true });
      return send(res, 200, { ok: true });
    }

    // Phase 59: first sign-in in the browser on a new server (src/claim.ts, docs/THREAT_MODEL.md).
    // GET tells the sign-in page whether setup is open; POST claims the server: a new owner token
    // (the one in the log stops working), shown once, and this browser is signed in.
    if (a === 'claim' && !b && !opts.demo && (method === 'GET' || method === 'POST')) {
      const claim = opts.claim;
      if (method === 'GET') return send(res, 200, claim ? claim.status() : { open: false });
      sameSiteOnly();
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      const body = await readJson(req);
      if (!claim) throw new HttpError(404, 'This server already has an owner. Sign in with the owner token.');
      const check = claim.check(ip, body.code);
      if (!check.ok) {
        if (check.wrongCode) {
          limiter.fail(ip);
          claim.failed();
        }
        throw new HttpError(check.status, check.message);
      }
      claim.finish();
      // A fresh token, without setupPending: setup never reopens on this server.
      const token = auth.resetToken();
      limiter.reset(ip);
      rmSync(join(app.dataDir, 'first-token.txt'), { force: true });
      const session = auth.createSession(deviceLabel(req.headers['user-agent']));
      res.setHeader('set-cookie', cookie(session.value, session.maxAgeSeconds));
      console.log(`Sara was set up in the browser (${claim.mode === 'browser' ? 'behind the platform login' : 'with the setup code'}) from ${ip}. The owner token printed earlier no longer works.`);
      return send(res, 200, { ok: true, token });
    }

    // Phase 24: passkey sign-in (no token, no code: the passkey checks it's you).
    if (a === 'passkey' && (b === 'signin-options' || b === 'signin') && method === 'POST') {
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      const site = passkeySite(req);
      const body = await readJson(req);
      if (b === 'signin-options') {
        limiter.fail(ip, Date.now(), 0.2); // asking is cheap but not free: 50 asks = one failed sign-in budget
        if (!auth.passkeys().length) throw new HttpError(404, 'No passkeys yet: sign in with the owner token, then add one in Settings → Devices and sign-in.');
        return send(res, 200, { challenge: issueChallenge('signin'), rpId: site.rpId, userVerification: 'required', timeout: 120_000 });
      }
      const id = String(body.id ?? '');
      const key = auth.passkey(id);
      try {
        if (!key) throw new Error("This passkey isn't registered here (it may have been removed).");
        const count = verifyAssertion(
          { id, clientDataJSON: String(body.clientDataJSON ?? ''), authenticatorData: String(body.authenticatorData ?? ''), signature: String(body.signature ?? '') },
          key,
          { challenge: takeChallenge(clientChallenge(body.clientDataJSON), 'signin'), ...site },
        );
        auth.usedPasskey(id, count);
      } catch (err) {
        limiter.fail(ip);
        throw new HttpError(401, (err as Error).message);
      }
      limiter.reset(ip);
      const session = auth.createSession(deviceLabel(req.headers['user-agent']));
      res.setHeader('set-cookie', cookie(session.value, session.maxAgeSeconds));
      return send(res, 200, { ok: true });
    }

    // Phase 16: sign in a new phone or computer with a one-time code (or by scanning its QR code)
    // instead of typing the owner token. Codes last 10 minutes and work once.
    if (a === 'pair' && b === 'redeem' && method === 'POST') {
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      const body = await readJson(req);
      const given = normalizePairCode(String(body.code ?? ''));
      const ok = pairing && pairing.expires > Date.now() && given.length === PAIR_LEN && timingSafeEqual(createHash('sha256').update(given).digest(), pairing.hash);
      if (!ok) {
        limiter.fail(ip);
        throw new HttpError(401, 'That code is wrong or has expired. Make a new one in Settings → Devices and sign-in.');
      }
      pairing = undefined;
      limiter.reset(ip);
      const session = auth.createSession(deviceLabel(req.headers['user-agent']));
      res.setHeader('set-cookie', cookie(session.value, session.maxAgeSeconds));
      return send(res, 200, { ok: true });
    }

    if (a === 'logout' && method === 'POST') {
      sameSiteOnly();
      // Signing out forgets this device, so the old cookie can't be reused.
      const id = auth.sessionId(cookies(req)[SESSION_COOKIE]);
      if (id) auth.signOut(id);
      res.setHeader('set-cookie', cookie('', 0));
      return send(res, 200, { ok: true });
    }

    if (a === 'session' && method === 'GET') {
      const authed = isAuthed(req);
      return send(res, 200, {
        authenticated: authed,
        // The companion's name is private to the owner; the sign-in page stays generic.
        disclosure: authed ? disclosureText(app.persona.name, appLanguage(app.settings.get())) : DISCLOSURE_TEXT.replace(/^Sara is/, 'This is'),
        disclosureAccepted: authed ? (opts.demo ? demoAccepted.has(visitorKey(req)) : Boolean(app.settings.get().disclosureAcceptedAt)) : false,
        ...(opts.demo ? { demo: true } : {}),
        // Phase 24: the sign-in page offers "Sign in with a passkey" when one exists.
        ...(!authed && !opts.demo && auth.passkeys().length ? { passkeys: true } : {}),
        // Phase 59: a new server that can be set up in the browser (only while nobody has signed in).
        ...(() => {
          const st = !authed && !opts.demo && auth.setupPending ? opts.claim?.status() : undefined;
          return st && (st.open || st.closed) ? { claim: st } : {};
        })(),
        ...(authed ? { identity: identityOf(app.persona) } : {}),
        // Phase 53: the app language (the page loads its translations before showing anything).
        ...(authed ? { language: app.settings.get().language ?? 'auto', appLanguage: appLanguage(app.settings.get()) } : {}),
        // Phase 16: servers that had adult content before the switch existed ask once (web only).
        ...(authed && app.settings.get().adultMode?.ask && !fromSaraApp(req) ? { adultAsk: true } : {}),
      });
    }

    // Google sends the browser back here after the owner allowed (or refused) access. The session
    // cookie is SameSite=Strict, so it isn't sent on this cross-site return: the one-time `state`
    // (made for the signed-in owner, 10 minutes) is what proves it. The small page then forwards
    // to the app as a same-site navigation, so the owner arrives signed in.
    if (a === 'google' && b === 'callback' && method === 'GET' && app.google) {
      const url = new URL(req.url ?? '/', 'http://x');
      let result = 'connected';
      const error = url.searchParams.get('error');
      if (error) result = error === 'access_denied' ? 'refused' : 'failed';
      else {
        try {
          await app.google.finish(url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '');
        } catch (err) {
          result = 'failed';
          console.warn(`google sign-in: ${(err as Error).message}`);
        }
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
      return void res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/#google=${result}"><title>Google</title><p>Back to the app… <a href="/#google=${result}">continue</a></p>`);
    }

    if (a === 'demo' && b === 'start' && method === 'POST' && opts.demo) {
      sameSiteOnly();
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      limiter.fail(ip); // counts toward the same per-address limit as sign-ins
      const session = auth.createSession(`Demo · ${deviceLabel(req.headers['user-agent'])}`);
      res.setHeader('set-cookie', cookie(session.value, Math.min(session.maxAgeSeconds, 24 * 3600)));
      return send(res, 200, { ok: true });
    }

    if (!isAuthed(req)) throw new HttpError(401, 'Sign in first.');
    // Security review: an app signed in with a device code (terminal, VS Code) can chat and work,
    // but can't change how you sign in, list or sign out devices, make pairing codes or let in
    // other apps: those need you in the web app.
    if (deviceTokenOf(req) && DEVICE_TOKEN_DENIED.has(a) && !(a === 'device' && (b === 'logout' || b === 'whoami'))) {
      throw new HttpError(403, 'Apps signed in with a device code can\'t change sign-in settings or devices. Use the web app (Settings → Devices and sign-in).');
    }
    // Hardening M4: Home Assistant's token only talks with her in the conversations it made.
    {
      const devId = deviceTokenOf(req);
      if (devId && auth.deviceKind(devId) === 'home-assistant') return homeAssistantApi(req, res, method, parts, devId);
    }
    if (opts.demo && method !== 'GET' && !DEMO_WRITES.has(a)) throw new HttpError(403, 'Not available in the demo.');
    if (opts.demo && method === 'GET' && !DEMO_READS.has(a)) throw new HttpError(403, 'Not available in the demo.');

    // Cross-site request guard (in addition to SameSite=Strict cookies).
    const origin = req.headers.origin;
    if (origin && method !== 'GET') {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        // "null" or malformed origin
      }
      if (originHost !== req.headers.host) throw new HttpError(403, 'Cross-origin request refused.');
    }

    // Demo (app review): the reviewer code unlocks live calls for this demo session.
    if (a === 'demo' && b === 'call-code' && method === 'POST' && opts.demo) {
      const body = await readJson(req);
      if (!demoCalls.enabled) throw new HttpError(403, 'Live calls are off in the demo.');
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      // Hardening L3: a daily cap on wrong codes from all addresses together.
      if (demoCalls.lockedToday) throw new HttpError(429, 'Too many wrong reviewer codes today. Try again tomorrow.');
      if (!demoCalls.unlock(visitorKey(req), body.code)) {
        limiter.fail(ip);
        throw new HttpError(403, 'That reviewer code is not right.');
      }
      return send(res, 200, { ok: true, demo: demoCalls.view(visitorKey(req)) });
    }

    if (a === 'disclosure' && b === 'accept' && method === 'POST') {
      if (opts.demo) {
        demoAccepted.add(visitorKey(req));
        return send(res, 200, { ok: true });
      }
      app.settings.update({ disclosureAcceptedAt: app.now().toISOString() });
      return send(res, 200, { ok: true });
    }

    if (a === 'settings') {
      if (method === 'GET') {
        const s = app.settings.get();
        return send(res, 200, {
          ownerName: s.ownerName ?? '',
          timeZone: s.timeZone ?? '',
          historyBudgetChars: s.historyBudgetChars ?? HISTORY_BUDGET_CHARS,
          defaultProviderId: s.defaultProviderId ?? null,
          defaultModel: s.defaultModel ?? null,
          routes: s.routes ?? {},
          safetyClassifier: s.safetyClassifier ?? null,
          claimJudge: s.claimJudge ?? null,
          fallbackAfterSec: s.fallbackAfterSec ?? 60,
          defaultFallbacks: s.defaultFallbacks ?? [],
          companionModel: s.companionModel ?? null,
          // Phase 56: retired models in use switch to their replacement (default on).
          modelAutoSwitch: s.modelAutoSwitch !== false,
          innerLife: s.persona?.innerLife !== false,
          typing: s.persona?.typing ?? 'instant',
          proactive: proactiveSettings(app),
          // Phase 53: app language, her talk language, the yearly look back.
          language: s.language ?? 'auto',
          languageDetected: s.languageDetected ?? null,
          appLanguage: appLanguage(s),
          talkLanguage: s.talkLanguage ?? 'auto',
          storyYearly: s.story?.yearly === true,
          // Phase 46: how the owner reaches her (read-only; the installer sets it).
          access: accessInfo(),
          // Phase 46c: admin commands in this system's words (sudo sara … / sara … / docker …).
          admin: adminHelp(),
        });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        const patch: Partial<Settings> = {};
        if (body.ownerName !== undefined) patch.ownerName = String(body.ownerName).slice(0, 80);
        // Phase 53: languages ('auto' or one of ours) and the yearly look back.
        const langPick = (v: unknown, what: string) => {
          if (v === 'auto' || v === '' || v === null) return 'auto';
          const l = toLang(v);
          if (!l || l !== v) throw new HttpError(400, '{what}: unknown language.', { params: { what } });
          return l;
        };
        if (body.language !== undefined) patch.language = langPick(body.language, 'Language');
        if (body.talkLanguage !== undefined) patch.talkLanguage = langPick(body.talkLanguage, 'Talk to me in');
        if (body.languageDetected !== undefined) patch.languageDetected = toLang(body.languageDetected) ?? 'en';
        if (body.storyYearly !== undefined) patch.story = { ...app.settings.get().story, yearly: Boolean(body.storyYearly) };
        if (body.historyBudgetChars !== undefined) {
          const n = Number(body.historyBudgetChars);
          if (!Number.isFinite(n) || n < 8_000 || n > 2_000_000) throw new HttpError(400, 'Conversation length must be between 8,000 and 2,000,000 characters.');
          patch.historyBudgetChars = Math.round(n);
        }
        if (body.timeZone !== undefined) {
          const tz = String(body.timeZone);
          if (tz) {
            try {
              new Intl.DateTimeFormat('en-US', { timeZone: tz });
            } catch {
              throw new HttpError(400, 'Unknown time zone');
            }
          }
          patch.timeZone = tz || undefined;
        }
        if (body.defaultProviderId !== undefined) {
          const id = body.defaultProviderId ? String(body.defaultProviderId) : undefined;
          if (id && !app.settings.get().providers.some((p) => p.id === id)) throw new HttpError(400, 'Unknown provider');
          patch.defaultProviderId = id;
        }
        if (body.defaultModel !== undefined) patch.defaultModel = body.defaultModel ? String(body.defaultModel).slice(0, 200) : undefined;
        if (body.routes !== undefined) {
          if (!body.routes || typeof body.routes !== 'object') throw new HttpError(400, 'routes must be an object');
          const routes: NonNullable<Settings['routes']> = {};
          for (const [k, v] of Object.entries(body.routes as Record<string, unknown>)) {
            if (!ROUTE_PURPOSES.includes(k as RoutePurpose)) throw new HttpError(400, 'Unknown route "{route}"', { params: { route: k } });
            if (!v) continue;
            const r = v as { providerId?: unknown; model?: unknown };
            const pid = String(r.providerId ?? '');
            const prov = app.settings.get().providers.find((p) => p.id === pid);
            if (!prov) throw new HttpError(400, 'Route "{route}": unknown provider', { params: { route: k } });
            if (k === 'private' && !prov.local) throw new HttpError(400, 'The private route must use a local provider; {provider} isn\'t marked local.', { params: { provider: prov.label } });
            const model = String(r.model ?? '').trim().slice(0, 200);
            if (!model) throw new HttpError(400, 'Route "{route}": choose a model', { params: { route: k } });
            if (k === 'private' && isCloudModel(model)) throw new HttpError(400, '{model} is an Ollama cloud model (it runs on Ollama\'s servers). Private conversations need a model on your own hardware.', { params: { model } });
            const fallbacks = cleanModelList((v as { fallbacks?: unknown }).fallbacks, k === 'private');
            routes[k as RoutePurpose] = { providerId: pid, model, ...(fallbacks.length ? { fallbacks } : {}) };
          }
          patch.routes = routes;
        }
        // Phase 38: backups for the default model, how long to wait, her own model.
        if (body.defaultFallbacks !== undefined) patch.defaultFallbacks = cleanModelList(body.defaultFallbacks, false);
        if (body.fallbackAfterSec !== undefined) {
          const n = Math.round(Number(body.fallbackAfterSec));
          if (!Number.isFinite(n) || n < 10 || n > 300) throw new HttpError(400, 'Switch after: between 10 and 300 seconds.');
          patch.fallbackAfterSec = n;
        }
        if (body.companionModel !== undefined) {
          const c = body.companionModel as { providerId?: unknown; model?: unknown } | null;
          if (!c || !c.providerId) patch.companionModel = undefined;
          else {
            const prov = app.settings.get().providers.find((p) => p.id === String(c.providerId));
            const model = String(c.model ?? '').trim().slice(0, 200);
            if (!prov || !model) throw new HttpError(400, 'Her model: choose a provider and a model.');
            patch.companionModel = { providerId: prov.id, model };
          }
        }
        if (body.safetyClassifier !== undefined) {
          const c = body.safetyClassifier as { providerId?: unknown; model?: unknown } | null;
          if (!c || !c.providerId) patch.safetyClassifier = undefined;
          else {
            const prov = app.settings.get().providers.find((p) => p.id === String(c.providerId));
            if (!prov) throw new HttpError(400, 'Safety classifier: unknown provider');
            const model = String(c.model ?? '').trim();
            if (!model) throw new HttpError(400, 'Safety classifier: choose a model');
            patch.safetyClassifier = { providerId: prov.id, model };
          }
        }
        if (body.claimJudge !== undefined) {
          // Phase 62: the claim judge uses only the model picked here (a cloud one only if picked).
          const c = body.claimJudge as { providerId?: unknown; model?: unknown } | null;
          if (!c || !c.providerId) patch.claimJudge = undefined;
          else {
            const prov = app.settings.get().providers.find((p) => p.id === String(c.providerId));
            if (!prov) throw new HttpError(400, 'Claim check: unknown provider');
            const model = String(c.model ?? '').trim();
            if (!model) throw new HttpError(400, 'Claim check: choose a model');
            patch.claimJudge = { providerId: prov.id, model };
          }
        }
        if (body.modelAutoSwitch !== undefined) patch.modelAutoSwitch = Boolean(body.modelAutoSwitch);
        if (body.innerLife !== undefined) patch.persona = { ...app.settings.get().persona, ...patch.persona, innerLife: Boolean(body.innerLife) };
        if (body.typing === 'instant' || body.typing === 'human') patch.persona = { ...app.settings.get().persona, ...patch.persona, typing: body.typing };
        if (body.proactive !== undefined) {
          const p = (body.proactive ?? {}) as Record<string, unknown>;
          const cur = proactiveSettings(app);
          const hour = (x: unknown, d: number) => (x === undefined ? d : Math.min(23, Math.max(0, Math.round(Number(x)))));
          patch.proactive = {
            enabled: p.enabled === undefined ? cur.enabled : Boolean(p.enabled),
            maxPerDay: p.maxPerDay === undefined ? cur.maxPerDay : Math.min(10, Math.max(0, Math.round(Number(p.maxPerDay) || 0))),
            quietStart: hour(p.quietStart, cur.quietStart),
            quietEnd: hour(p.quietEnd, cur.quietEnd),
            minGapHours: p.minGapHours === undefined ? cur.minGapHours : Math.min(168, Math.max(1, Number(p.minGapHours) || cur.minGapHours)),
          };
        }
        app.settings.update(patch);
        return send(res, 200, { ok: true });
      }
    }

    // Phase 38: which model does what: jobs, recommended picks, a test, the side-by-side test.
    if (a === 'model-jobs') {
      if (!b && method === 'GET') {
        const s = app.settings.get();
        return send(res, 200, {
          jobs: JOBS,
          vectors: app.vectors?.status() ?? null,
          costs: Object.fromEntries(s.providers.map((p) => [p.id, { local: Boolean(p.local), hint: costHint(p, p.defaultModel ?? '') }])),
        });
      }
      if (b === 'recommend' && method === 'GET') {
        const s = app.settings.get();
        const cands = await connectedModels(app);
        return send(res, 200, { picks: recommend(cands, { providerId: s.defaultProviderId, model: s.defaultModel }), models: cands.length });
      }
      if ((b === 'test' || b === 'compare') && method === 'POST') {
        const body = await readJson(req);
        const job = String(body.job ?? '') as RoutePurpose;
        if (!ROUTE_PURPOSES.includes(job)) throw new HttpError(400, 'Unknown job');
        if (b === 'test') {
          const pid = String(body.providerId ?? '');
          const model = String(body.model ?? '').trim();
          if (!pid || !model) throw new HttpError(400, 'Choose a provider and a model first.');
          return send(res, 200, await testModel(app, job, pid, model));
        }
        if (job === 'embeddings') throw new HttpError(400, 'Meaning search has no answers to compare; use Test.');
        const cands = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 3).map((c: { providerId?: unknown; model?: unknown }) => ({ providerId: String(c?.providerId ?? ''), model: String(c?.model ?? '').trim() })).filter((c: { providerId: string; model: string }) => c.providerId && c.model);
        if (cands.length < 2) throw new HttpError(400, 'Pick two or three models to compare.');
        return send(res, 200, { prompt: comparePrompt(job), results: await compareModels(app, job, cands) });
      }
    }

    if (a === 'safety' && b === 'stats' && method === 'GET') return send(res, 200, app.store.safetyEventCounts());

    // Phase 49: preview links (owner only). Listing, opening one for a job's port, closing.
    if (a === 'previews') {
      if (!app.previews) throw new HttpError(404, 'Previews are not available on this server.');
      const shown = (p: import('./preview.ts').Preview) => ({ token: p.token, url: previewUrl(p), workspace: p.workspace, port: p.port, path: p.path, jobId: p.jobId, jobLabel: p.jobLabel, conversationId: p.conversationId, expiresAt: new Date(p.expiresAt).toISOString() });
      if (!b && method === 'GET') {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        const ws = q.get('workspace') ?? undefined;
        const conversationId = q.get('conversationId') ?? undefined;
        return send(res, 200, { previews: app.previews.list({ ...(ws ? { workspace: ws } : {}), ...(conversationId ? { conversationId } : {}) }).map(shown) });
      }
      if (!b && method === 'POST') {
        const body = await readJson(req);
        const conv = app.store.getConversation(String(body.conversationId ?? ''));
        if (!conv || conv.partner) throw new HttpError(404, 'Conversation not found');
        try {
          const p = await app.previews.start({ conversationId: conv.id, workspace: conv.workspace, ...(body.port !== undefined ? { port: Number(body.port) } : {}), path: String(body.path ?? '/'), jobs: app.jobs });
          return send(res, 200, shown(p));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (b && !c && method === 'DELETE') return send(res, 200, { ok: app.previews.stop(b) });
    }

    if (a === 'tools' && !b) {
      if (method === 'GET') {
        const s = app.settings.get();
        return send(res, 200, {
          tools: app.tools.list().map((t) => ({
            name: t.spec.name,
            description: t.spec.description,
            defaultPermission: t.defaultPermission,
            permission: app.tools.permission(t.spec.name, s.toolPermissions),
            source: t.source ?? 'built-in',
            available: t.isAvailable?.() ?? true,
          })),
          sandbox: { mode: app.sandbox.mode, detail: app.sandbox.detail, ...(app.sandbox.mode === 'none' ? { note: noSandboxNote() } : {}) },
          shellNetwork: s.shellNetwork ?? true,
          // Phase 49: the browser she tests web apps with.
          browser: app.browsers ? (({ found, name, how }) => ({ found, name: name ?? null, how }))(new URL(req.url ?? '/', 'http://x').searchParams.get('recheck') ? app.browsers.refresh() : app.browsers.status()) : { found: false, name: null, how: 'Not available on this server.' },
        });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        const patch: Partial<Settings> = {};
        if (body.permissions !== undefined) {
          if (!body.permissions || typeof body.permissions !== 'object') throw new HttpError(400, 'permissions must be an object');
          const perms: Record<string, Permission> = { ...app.settings.get().toolPermissions };
          for (const [name, value] of Object.entries(body.permissions as Record<string, unknown>)) {
            if (!app.tools.get(name)) throw new HttpError(400, 'Unknown tool {name}', { params: { name } });
            if (!PERMISSIONS.includes(value as Permission)) throw new HttpError(400, 'Invalid permission for {name}', { params: { name } });
            perms[name] = value as Permission;
          }
          patch.toolPermissions = perms;
        }
        if (body.shellNetwork !== undefined) patch.shellNetwork = Boolean(body.shellNetwork);
        app.settings.update(patch);
        return send(res, 200, { ok: true });
      }
    }

    if (a === 'search' && !b) {
      if (method === 'GET') {
        const s = app.settings.get().search;
        return send(res, 200, {
          providers: SEARCH_PROVIDERS,
          provider: s?.provider ?? null,
          url: s?.url ?? '',
          hasKey: s ? app.vault.has(searchVaultKey(s.provider)) : false,
          ready: Boolean(searchConfig(app.settings, app.vault)),
        });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        if (!body.provider) {
          app.settings.update({ search: undefined });
          return send(res, 200, { ok: true });
        }
        const provider = body.provider as SearchProvider;
        if (!SEARCH_PROVIDERS.includes(provider)) throw new HttpError(400, 'Unknown search provider');
        let url: string | undefined;
        if (provider === 'searxng') {
          try {
            url = new URL(String(body.url ?? '')).href;
          } catch {
            throw new HttpError(400, 'SearXNG needs a valid URL');
          }
        }
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) app.vault.set(searchVaultKey(provider), body.apiKey.trim());
        app.settings.update({ search: { provider, ...(url ? { url } : {}) } });
        return send(res, 200, { ok: true });
      }
    }

    if (a === 'mcp' && b === 'presets' && method === 'GET') return send(res, 200, MCP_PRESETS);
    if (a === 'mcp') {
      const view = () =>
        (app.settings.get().mcpServers ?? []).map((cfg) => {
          const conn = app.mcp?.get(cfg.name);
          const sec = mcpSecrets(app.vault, cfg.name);
          return {
            ...cfg,
            status: cfg.enabled ? (conn?.status ?? 'stopped') : 'disabled',
            error: conn?.error ?? '',
            tools: conn?.tools.map((t) => t.name) ?? [],
            envKeys: Object.keys(sec.env ?? {}),
            headerKeys: Object.keys(sec.headers ?? {}),
          };
        });
      if (!b && method === 'GET') return send(res, 200, await view());
      if (b && !c && method === 'PUT') {
        const body = await readJson(req);
        let cfg: McpServerConfig;
        try {
          cfg = validateMcpConfig(body, b);
          const cur = mcpSecrets(app.vault, b);
          const next = { env: mergeSecrets(cur.env, body.env), headers: mergeSecrets(cur.headers, body.headers) };
          app.vault.set(mcpVaultKey(b), JSON.stringify(next));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        const servers = (app.settings.get().mcpServers ?? []).filter((s) => s.name !== b).concat(cfg);
        app.settings.update({ mcpServers: servers });
        await app.mcp?.start(cfg);
        return send(res, 200, await view());
      }
      if (b && !c && method === 'DELETE') {
        app.mcp?.stop(b);
        app.settings.update({ mcpServers: (app.settings.get().mcpServers ?? []).filter((s) => s.name !== b) });
        app.vault.delete(mcpVaultKey(b));
        return send(res, 200, await view());
      }
      if (b && c === 'restart' && method === 'POST') {
        const cfg = (app.settings.get().mcpServers ?? []).find((s) => s.name === b);
        if (!cfg) throw new HttpError(404, 'MCP server not found');
        await app.mcp?.start(cfg);
        return send(res, 200, await view());
      }
    }

    if (a === 'events' && !b && method === 'GET') return streamEvents(req, res);

    if (a === 'subscriptions') {
      const subs = app.subscriptions;
      if (!subs) throw new HttpError(404, 'Subscriptions are not available');
      // Signing in adds the matching provider (and makes it the default when there is none).
      const ensureProvider = (presetId: string) => {
        const s = app.settings.get();
        if (s.providers.some((p) => p.id === presetId)) return;
        const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)!;
        app.settings.update({ providers: [...s.providers, { ...preset }], ...(s.defaultProviderId ? {} : { defaultProviderId: preset.id, defaultModel: preset.defaultModel }) });
      };
      const view = () => ({ chatgpt: subs.chatgpt.status(), claude: subs.claudeStatus(), grok: subs.grokStatus() });
      if (!b && method === 'GET') return send(res, 200, await view());
      if (b === 'chatgpt') {
        if (c === 'start' && method === 'POST') {
          const body = await readJson(req);
          return send(res, 200, await subs.chatgpt.start({ forceConsent: body.enablePlan === true }));
        }
        if (c === 'complete' && method === 'POST') {
          const body = await readJson(req);
          try {
            const st = await subs.chatgpt.complete(String(body.url ?? ''));
            if (st.planUsage) ensureProvider('chatgpt');
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
          return send(res, 200, await view());
        }
        if (c === 'welcomed' && method === 'POST') {
          subs.chatgpt.markWelcomed();
          return send(res, 200, await view());
        }
        if (c === 'signout' && method === 'POST') {
          const r = await subs.chatgpt.signOut();
          return send(res, 200, { ...view(), revoked: r.revoked });
        }
      }
      if (b === 'claude' && c === 'login' && method === 'POST') {
        try {
          const login = await subs.startClaudeLogin();
          return send(res, 200, { ...view(), login });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (b === 'claude' && c === 'code' && method === 'POST') {
        const body = await readJson(req);
        try {
          await subs.finishClaudeLogin(String(body.code ?? ''));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        ensureProvider('claude-sub');
        return send(res, 200, await view());
      }
      if (b === 'claude' && !c) {
        if (method === 'PUT') {
          const body = await readJson(req);
          try {
            subs.setClaudeToken(String(body.token ?? ''));
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
          ensureProvider('claude-sub');
          return send(res, 200, await view());
        }
        if (method === 'DELETE') {
          subs.clearClaude();
          return send(res, 200, await view());
        }
      }
      if (b === 'grok') {
        if (c === 'login' && method === 'POST') {
          try {
            const login = await subs.startGrokLogin();
            return send(res, 200, { ...view(), login });
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
        }
        if (c === 'logout' && method === 'POST') {
          await subs.grokLogout();
          return send(res, 200, await view());
        }
        if (c === 'check' && method === 'POST') {
          const v = view();
          if (v.grok.signedIn) ensureProvider('grok-sub');
          return send(res, 200, v);
        }
      }
    }

    if (a === 'doctor' && !b && method === 'GET') return send(res, 200, await runDoctor({ dataDir: rootDir, settings: app.settings, vault: app.vault, subscriptions: app.subscriptions, now: app.now(), sandbox: app.sandbox, tools: app.tools }));
    if (a === 'status' && !b && method === 'GET') return send(res, 200, healthReport(app, opts.info ?? { version: 'dev', revision: null, startedAt: new Date().toISOString() }));

    // Phase 31: companions (more than one on this server).
    if (a === 'companions') {
      const cm = opts.companions;
      if (!cm) throw new HttpError(404, 'Not found');
      if (opts.demo && method !== 'GET') throw new HttpError(403, 'Not on the demo server.');
      const view = () => ({ companions: cm.view(app.companionId ?? 'main'), planner: app.settings.get().companionPlanner ?? 'shared' });
      if (!b && method === 'GET') return send(res, 200, await view());
      if (!b && method === 'POST') {
        const body = (await readJson(req)) as { name?: unknown; pronouns?: unknown; from?: unknown };
        const name = String(body.name ?? '').trim();
        if (!name || name.length > 40) throw new HttpError(400, 'Give her (or him) a name of up to 40 characters.');
        if (cm.all().length >= 8) throw new HttpError(400, 'Up to 8 companions on one server.');
        if (cm.all().some((c) => c.app.persona.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, 'There\'s already a companion called {name}.', { params: { name } });
        const pronouns = ['she', 'he', 'they'].includes(String(body.pronouns)) ? String(body.pronouns) : 'she';
        const from = body.from ? cm.get(String(body.from)) : undefined;
        if (body.from && !from) throw new HttpError(400, 'No such companion to copy.');
        const persona = newCompanionPersona(from ? from.app.persona : app.defaultPersonaPath ? loadPersona(app.defaultPersonaPath) : app.persona, name, pronouns, !from);
        const { id, dir } = createCompanionDir(rootDir, persona, app.now());
        try {
          const c = cm.build!(id, dir);
          cm.add(c);
          c.start();
        } catch (err) {
          retireCompanionDir(rootDir, id, app.now());
          throw err;
        }
        return send(res, 200, { ...view(), id });
      }
      // Which companion a conversation belongs to (answering another companion's call).
      if (b === 'of' && c && method === 'GET') {
        const owner = cm.byConversation(c);
        if (!owner) throw new HttpError(404, 'Not found');
        return send(res, 200, { id: owner.id, name: owner.app.persona.name });
      }
      if (b === 'planner' && method === 'PUT') {
        const body = (await readJson(req)) as { planner?: unknown };
        if (body.planner !== 'shared' && body.planner !== 'separate') throw new HttpError(400, 'Choose shared or separate.');
        app.settings.update({ companionPlanner: body.planner });
        return send(res, 200, { ...view(), restart: cm.all().length > 1 });
      }
      if (b && !c && method === 'DELETE') {
        if (!cm.get(b)) throw new HttpError(404, 'No such companion.');
        await cm.remove(b).catch((err: Error) => {
          throw new HttpError(400, err.message);
        });
        return send(res, 200, await view());
      }
    }
    // Phase 30: health history (chart) and Sara's log (recent problems, download).
    if (a === 'health' && b === 'history' && method === 'GET') {
      const days = new URL(req.url ?? '/', 'http://x').searchParams.get('days');
      const h = app.healthHistory;
      if (!h) return send(res, 200, { buckets: [], up: 0 });
      return send(res, 200, days ? h.history({ days: Math.min(31, Math.max(1, Number(days) || 7)) }) : h.history({ hours: 24 }));
    }
    if (a === 'logs' && method === 'GET') {
      const log = app.log;
      if (!b) return send(res, 200, { lines: log ? log.recent({ problems: new URL(req.url ?? '/', 'http://x').searchParams.get('problems') === '1', limit: 100 }) : [] });
      if (b === 'download') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="sara-log-${app.now().toISOString().slice(0, 10)}.txt"`, 'cache-control': 'no-store', ...SECURITY_HEADERS });
        return void res.end(log ? log.text() : '');
      }
    }
    if (a === 'backups' && b === 'offsite') {
      const view = () => {
        const o = offsiteSettings(app);
        return { ...o, hasPassphrase: app.vault.has(OFFSITE_PASS_VAULT), hasS3Secret: app.vault.has(OFFSITE_S3_VAULT) };
      };
      if (!c && method === 'GET') return send(res, 200, await view());
      if (!c && method === 'PUT') {
        const body = await readJson(req);
        const cur = offsiteSettings(app);
        const kind = body.kind === 'folder' || body.kind === 's3' ? body.kind : body.kind === 'off' ? 'off' : cur.kind;
        const next = { ...cur, kind } as typeof cur;
        if (body.path !== undefined) {
          const p = String(body.path).trim();
          if (p && !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p)) throw new HttpError(400, 'Use a full folder path, like {example}.', { params: { example: process.platform === 'win32' ? 'D:\\Backups\\Sara' : process.platform === 'darwin' ? '/Volumes/Backup/Sara' : '/mnt/backup-drive/sara' } });
          next.path = p || undefined;
        }
        for (const k of ['endpoint', 'bucket', 'region', 'accessKeyId', 'prefix'] as const) if (body[k] !== undefined) next[k] = String(body[k]).trim().slice(0, 300) || undefined;
        if (next.endpoint && !/^https?:\/\//.test(next.endpoint)) throw new HttpError(400, 'The storage endpoint must start with https://');
        if (body.keep !== undefined) next.keep = Math.max(1, Math.min(365, Math.round(Number(body.keep) || 14)));
        if (typeof body.passphrase === 'string' && body.passphrase) {
          if (body.passphrase.length < 10) throw new HttpError(400, 'Use a passphrase of at least 10 characters.');
          app.vault.set(OFFSITE_PASS_VAULT, body.passphrase);
        }
        if (typeof body.s3Secret === 'string' && body.s3Secret) app.vault.set(OFFSITE_S3_VAULT, body.s3Secret);
        app.settings.update({ offsite: next });
        return send(res, 200, await view());
      }
      if (c === 'test' && method === 'POST') {
        // Phase 30: restore the newest off-server copy into a temporary folder and check it.
        await testOffsite(app);
        return send(res, 200, await view());
      }
      if (c === 'upload' && method === 'POST') {
        const latest = listBackups(rootDir)[0];
        if (!latest) throw new HttpError(400, 'There is no backup yet. Press "Back up now" first.');
        try {
          await copyOffsite(app, join(rootDir, BACKUPS_DIR, latest.name));
        } catch (err) {
          throw new HttpError(502, (err as Error).message);
        }
        return send(res, 200, await view());
      }
    }
    if (a === 'backups') {
      const cfg = () => ({ ...DEFAULT_BACKUP, ...app.settings.get().backup });
      if (!b && method === 'GET') return send(res, 200, { ...cfg(), backups: listBackups(rootDir) });
      if (!b && method === 'PUT') {
        const body = await readJson(req);
        const keep = body.keep === undefined ? cfg().keep : Math.max(1, Math.min(60, Math.round(Number(body.keep) || 7)));
        app.settings.update({ backup: { auto: body.auto === undefined ? cfg().auto : Boolean(body.auto), keep } });
        return send(res, 200, { ...cfg(), backups: listBackups(rootDir) });
      }
      if (!b && method === 'POST') {
        const name = backupName(app.now());
        const m = createBackup(rootDir, join(rootDir, BACKUPS_DIR, name), { saraVersion: opts.info?.version, now: app.now() });
        return send(res, 200, { name, files: m.files, backups: listBackups(rootDir) });
      }
      if (b && method === 'GET') {
        const item = listBackups(rootDir).find((x) => x.name === b);
        if (!item) throw new HttpError(404, 'No such backup');
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${item.name}"`, 'content-length': item.size, 'cache-control': 'no-store', ...SECURITY_HEADERS });
        createReadStream(join(rootDir, BACKUPS_DIR, item.name)).pipe(res);
        return;
      }
      if (b && method === 'DELETE') {
        const item = listBackups(rootDir).find((x) => x.name === b);
        if (!item) throw new HttpError(404, 'No such backup');
        rmSync(join(rootDir, BACKUPS_DIR, item.name), { force: true });
        return send(res, 200, { ...cfg(), backups: listBackups(rootDir) });
      }
    }

    if (a === 'push') {
      const push = app.push;
      if (!push) throw new HttpError(404, 'Push is not available');
      const view = () => ({
        publicKey: push.publicKey,
        preview: push.settings.preview,
        devices: push.list().map(({ endpoint, ...d }) => ({ ...d, id: endpoint.slice(-12) })),
        // iPhone app (Phase 17): whether a key is set (never the key itself) and the registered iPhones.
        apns: push.apns ? { keySet: Boolean(push.apns.key()), keyId: push.apns.key()?.keyId ?? null, bundleId: push.apns.key()?.bundleId ?? null, devices: push.apns.devices().map((d) => ({ id: d.token.slice(-12), label: d.label, sandbox: d.sandbox, createdAt: d.createdAt, lastOkAt: d.lastOkAt })) } : null,
      });
      if (!b && method === 'GET') return send(res, 200, await view());
      if (!b && method === 'PUT') {
        const body = await readJson(req);
        if (body.preview !== undefined) app.settings.update({ push: { ...push.settings, preview: Boolean(body.preview) } });
        return send(res, 200, await view());
      }
      if (b === 'subscribe' && method === 'POST') {
        const body = await readJson(req);
        const sub = body.subscription as { endpoint: string; keys: { p256dh: string; auth: string } } | undefined;
        // The page's origin (browsers send it on POST) becomes the VAPID contact; Apple requires https.
        const origin = typeof req.headers.origin === 'string' && req.headers.origin !== 'null' ? req.headers.origin : `http://${req.headers.host}`;
        try {
          push.subscribe(sub ?? ({} as never), origin, typeof body.label === 'string' ? body.label : '', auth.sessionId(cookies(req)[SESSION_COOKIE]));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        return send(res, 200, await view());
      }
      if (b === 'unsubscribe' && method === 'POST') {
        const body = await readJson(req);
        push.unsubscribe(String(body.endpoint ?? ''));
        return send(res, 200, await view());
      }
      if (b === 'apns' && push.apns) {
        const body = method === 'GET' ? {} : await readJson(req);
        if (method === 'PUT') {
          try {
            push.apns.setKey(body.p8 ? (body as never) : null);
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
          return send(res, 200, await view());
        }
        if (method === 'POST' && c === 'register') {
          try {
            push.apns.register(String(body.token ?? ''), body.sandbox === true, typeof body.label === 'string' ? body.label : 'iPhone', auth.sessionId(cookies(req)[SESSION_COOKIE]));
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
          return send(res, 200, { ok: true });
        }
        if (method === 'POST' && c === 'unregister') {
          push.apns.unregister(String(body.token ?? ''));
          return send(res, 200, await view());
        }
        // Remove an iPhone from Settings (by the short id shown there).
        if (method === 'POST' && c === 'remove') {
          const d = push.apns.devices().find((x) => x.token.slice(-12) === String(body.id ?? ''));
          if (d) push.apns.unregister(d.token);
          return send(res, 200, await view());
        }
      }
      if (b === 'test' && method === 'POST') {
        const r = await push.sendAll({ title: app.persona.name, body: trOwner("It's me. Notifications work. 💛", app.settings.get()), url: '/', tag: 'test' });
        return send(res, 200, r);
      }
    }

    if (a === 'bridges' && b === 'discord') {
      const dc = app.bridges?.discord;
      if (!dc) throw new HttpError(404, 'Discord bridge is not available');
      const view = () => {
        const s = discordSettings(app);
        return {
          ...dc.status(),
          enabled: s.enabled,
          allowServers: s.allowServers,
          mirror: s.mirror,
          linked: Boolean(s.ownerUserId),
          linkedId: s.ownerUserId ?? null,
          ownerUserIds: s.ownerUserIds ?? [],
          ownerWorkInServers: s.ownerWorkInServers === true,
          answerName: s.answerName === true,
          answerEveryone: s.answerEveryone === true,
          answerBots: s.answerBots === true,
          botAllowList: s.botAllowList ?? [],
          botTurnLimit: botTurnLimitOf(s),
          botHourlyCap: botHourlyCapOf(s),
          // Adult channels are part of Adult mode: only while it's on, and never in the phone and desktop apps.
          ...(fromSaraApp(req) || !adultModeOn(app.settings.get()) ? {} : { nsfwChannelIds: s.nsfwChannelIds ?? [] }),
          hasToken: Boolean(app.vault.get(DISCORD_VAULT)),
        };
      };
      if (!c && method === 'GET') return send(res, 200, await view());
      if (!c && method === 'PUT') {
        const body = await readJson(req);
        let tokenChanged = false;
        if (typeof body.token === 'string') {
          const t = body.token.trim();
          if (t && !/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(t)) throw new HttpError(400, 'That does not look like a Discord bot token.');
          if (t !== (app.vault.get(DISCORD_VAULT) ?? '')) tokenChanged = true;
          t ? app.vault.set(DISCORD_VAULT, t) : app.vault.delete(DISCORD_VAULT);
        }
        const cur = discordSettings(app);
        const before = JSON.stringify(app.settings.get().discord ?? null);
        app.settings.update({
          discord: {
            ...cur,
            ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
            ...(body.allowServers !== undefined ? { allowServers: Boolean(body.allowServers) } : {}),
            ...(body.mirror !== undefined ? { mirror: Boolean(body.mirror) } : {}),
            ...(body.ownerUserIds !== undefined ? { ownerUserIds: cleanDiscordIds(body.ownerUserIds) } : {}),
            ...(body.ownerWorkInServers !== undefined ? { ownerWorkInServers: Boolean(body.ownerWorkInServers) } : {}),
            ...(body.answerName !== undefined ? { answerName: Boolean(body.answerName) } : {}),
            ...(body.answerEveryone !== undefined ? { answerEveryone: Boolean(body.answerEveryone) } : {}),
            ...(body.answerBots !== undefined ? { answerBots: Boolean(body.answerBots) } : {}),
            ...(body.botAllowList !== undefined ? { botAllowList: cleanBotList(body.botAllowList) } : {}),
            ...(body.botTurnLimit !== undefined ? { botTurnLimit: botTurnLimitOf({ ...cur, botTurnLimit: Number(body.botTurnLimit) }) } : {}),
            ...(body.botHourlyCap !== undefined ? { botHourlyCap: botHourlyCapOf({ ...cur, botHourlyCap: Number(body.botHourlyCap) }) } : {}),
            ...(body.nsfwChannelIds !== undefined && !fromSaraApp(req) && adultModeOn(app.settings.get()) ? { nsfwChannelIds: cleanDiscordIds(body.nsfwChannelIds) } : {}),
            ...(body.unlink === true ? { ownerUserId: undefined } : {}),
          },
        });
        // H1: only a change to the bot's own settings reconnects it (autosave elsewhere must not drop the gateway).
        if (tokenChanged || JSON.stringify(app.settings.get().discord ?? null) !== before) await dc.restart();
        return send(res, 200, await view());
      }
      if (c === 'link' && method === 'POST') {
        const st = dc.status();
        if (!st.running) throw new HttpError(400, st.error ? `Discord isn't connected: ${st.error}` : 'Turn Discord on and save a bot token first.');
        return send(res, 200, { code: dc.newLinkCode(), bot: st.bot });
      }
    }

    if (a === 'bridges' && b === 'telegram') {
      const tg = app.bridges?.telegram;
      if (!tg) throw new HttpError(404, 'Telegram bridge is not available');
      const view = () => {
        const s = telegramSettings(app);
        return {
          ...tg.status(),
          enabled: s.enabled,
          allowOthers: s.allowOthers,
          mirror: s.mirror,
          linked: Boolean(s.ownerChatId),
          linkedId: s.ownerChatId ?? null,
          ownerUserIds: s.ownerUserIds ?? [],
          ownerWorkInGroups: s.ownerWorkInGroups === true,
          answerName: s.answerName === true,
          answerEveryone: s.answerEveryone === true,
          ...(fromSaraApp(req) || !adultModeOn(app.settings.get()) ? {} : { nsfwChatIds: s.nsfwChatIds ?? [] }),
          hasToken: Boolean(app.vault.get(TELEGRAM_VAULT)),
        };
      };
      if (!c && method === 'GET') return send(res, 200, await view());
      if (!c && method === 'PUT') {
        const body = await readJson(req);
        let tokenChanged = false;
        if (typeof body.token === 'string') {
          const t = body.token.trim();
          if (t && !/^\d{5,}:[\w-]{30,}$/.test(t)) throw new HttpError(400, 'That does not look like a bot token from @BotFather.');
          if (t !== (app.vault.get(TELEGRAM_VAULT) ?? '')) tokenChanged = true;
          t ? app.vault.set(TELEGRAM_VAULT, t) : app.vault.delete(TELEGRAM_VAULT);
        }
        const cur = telegramSettings(app);
        const before = JSON.stringify(app.settings.get().telegram ?? null);
        app.settings.update({
          telegram: {
            ...cur,
            ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
            ...(body.allowOthers !== undefined ? { allowOthers: Boolean(body.allowOthers) } : {}),
            ...(body.mirror !== undefined ? { mirror: Boolean(body.mirror) } : {}),
            ...(body.ownerUserIds !== undefined ? { ownerUserIds: cleanTelegramIds(body.ownerUserIds).filter((n) => n > 0) } : {}),
            ...(body.ownerWorkInGroups !== undefined ? { ownerWorkInGroups: Boolean(body.ownerWorkInGroups) } : {}),
            ...(body.answerName !== undefined ? { answerName: Boolean(body.answerName) } : {}),
            ...(body.answerEveryone !== undefined ? { answerEveryone: Boolean(body.answerEveryone) } : {}),
            ...(body.nsfwChatIds !== undefined && !fromSaraApp(req) && adultModeOn(app.settings.get()) ? { nsfwChatIds: cleanTelegramIds(body.nsfwChatIds).filter((n) => n < 0) } : {}),
            ...(body.unlink === true ? { ownerChatId: undefined } : {}),
          },
        });
        if (tokenChanged || JSON.stringify(app.settings.get().telegram ?? null) !== before) await tg.restart();
        return send(res, 200, await view());
      }
      if (c === 'link' && method === 'POST') {
        const st = tg.status();
        if (!st.running) throw new HttpError(400, st.error ? `Telegram isn't connected: ${st.error}` : 'Turn Telegram on and save a bot token first.');
        return send(res, 200, { code: tg.newLinkCode(), bot: st.bot });
      }
    }

    if (a === 'voice') {
      const cfg = (): VoiceSettings => {
        const v = app.settings.get().voice ?? {};
        return speech.settings();
      };
      if (!b && method === 'GET') {
        return send(res, 200, {
          settings: cfg(),
          local: app.voice?.available ?? { stt: false, tts: false },
          localSupported: localVoiceSupported(),
          ...(localVoiceSupported() ? {} : { localNote: `${localVoiceMissing()}.` }),
          voices: app.voice?.voices() ?? [],
          notes: { hear: speech.canHearNotes(), send: speech.canSendNotes() },
          expressiveSample: EXPRESSIVE_SAMPLE,
          keys: { openai: Boolean(app.vault.get(VOICE_VAULT.openai)), elevenlabs: Boolean(app.vault.get(VOICE_VAULT.elevenlabs)), xai: Boolean(app.vault.get(VOICE_VAULT.xai)), xaiShared: !app.vault.get(VOICE_VAULT.xai) && Boolean(xaiKeySync()), grokSubscription: grokSignedIn(), openaiRealtime: openaiLiveKeyInfo() },
          // Phase 48: live calls with Grok or OpenAI.
          live: liveView(),
          openaiLive: { voices: OPENAI_LIVE_VOICES, models: OPENAI_LIVE_MODELS },
        });
      }
      if (!b && method === 'PUT') {
        const body = await readJson(req);
        const cur = cfg();
        const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (v === undefined ? d : allowed.includes(v as T) ? (v as T) : (() => { throw new HttpError(400, 'Invalid value "{value}"', { params: { value: String(v) } }); })());
        const o = (body.openai ?? {}) as Record<string, unknown>;
        const e = (body.elevenlabs ?? {}) as Record<string, unknown>;
        const x = (body.xai ?? {}) as Record<string, unknown>;
        const r = (body.openaiRealtime ?? {}) as Record<string, unknown>;
        const str = (v: unknown, d: string, max = 200) => (v === undefined ? d : String(v).trim().slice(0, max));
        const next: VoiceSettings = {
          stt: pick(body.stt, ['off', 'local', 'openai'] as const, cur.stt),
          tts: pick(body.tts, ['off', 'local', 'openai', 'elevenlabs', 'xai'] as const, cur.tts),
          localVoice: body.localVoice === undefined ? cur.localVoice : String(body.localVoice),
          speed: body.speed === undefined ? cur.speed : Math.min(1.6, Math.max(0.6, Number(body.speed) || 1)),
          calls: pick(body.calls, ['live', 'classic'] as const, cur.calls ?? 'live'),
          live: pick(body.live, ['auto', 'grok', 'openai'] as const, cur.live ?? 'auto'),
          openaiRealtime: {
            voiceId: pick(r.voiceId, OPENAI_LIVE_VOICES, (cur.openaiRealtime?.voiceId ?? 'marin') as (typeof OPENAI_LIVE_VOICES)[number]),
            model: pick(r.model, OPENAI_LIVE_MODELS, (OPENAI_LIVE_MODELS as readonly string[]).includes(cur.openaiRealtime?.model ?? '') ? (cur.openaiRealtime!.model as (typeof OPENAI_LIVE_MODELS)[number]) : OPENAI_LIVE_MODELS[0]),
          },
          noteReplies: pick(body.noteReplies, ['voice', 'always', 'never'] as const, cur.noteReplies ?? 'voice'),
          expressive: pick(body.expressive, ['off', 'subtle', 'lively'] as const, cur.expressive ?? 'subtle'),
          tone: pick(body.tone, ['natural', 'warm', 'bright', 'calm'] as const, cur.tone ?? 'natural'),
          followMood: body.followMood === undefined ? cur.followMood !== false : Boolean(body.followMood),
          openai: { baseUrl: str(o.baseUrl, cur.openai.baseUrl, 300), sttModel: str(o.sttModel, cur.openai.sttModel), ttsModel: str(o.ttsModel, cur.openai.ttsModel), ttsVoice: str(o.ttsVoice, cur.openai.ttsVoice) },
          elevenlabs: { voiceId: str(e.voiceId, cur.elevenlabs.voiceId), model: str(e.model, cur.elevenlabs.model) },
          xai: { voiceId: str(x.voiceId, cur.xai.voiceId, 100) || 'eve', language: str(x.language, cur.xai.language, 20) || 'en' },
        };
        if (!/^https?:\/\//.test(next.openai.baseUrl)) throw new HttpError(400, 'Speech API URL must start with http(s)://');
        if (typeof body.openaiKey === 'string') body.openaiKey ? app.vault.set(VOICE_VAULT.openai, body.openaiKey.trim()) : app.vault.delete(VOICE_VAULT.openai);
        if (typeof body.elevenlabsKey === 'string') body.elevenlabsKey ? app.vault.set(VOICE_VAULT.elevenlabs, body.elevenlabsKey.trim()) : app.vault.delete(VOICE_VAULT.elevenlabs);
        if (typeof body.xaiKey === 'string') body.xaiKey ? app.vault.set(VOICE_VAULT.xai, body.xaiKey.trim()) : app.vault.delete(VOICE_VAULT.xai);
        app.settings.update({ voice: next });
        return send(res, 200, next);
      }
      if (b === 'xai-sample' && method === 'GET') {
        // A short sample in one Grok voice, to choose by ear. Nothing is saved to the settings;
        // each sample is kept on the server, so listening again costs nothing.
        const u = new URL(req.url ?? '/', 'http://x');
        const voiceId = u.searchParams.get('voice') ?? '';
        const lang = u.searchParams.get('lang') || 'en';
        if (!/^[\w-]{1,64}$/.test(voiceId) || !/^[\w-]{1,10}$/.test(lang)) throw new HttpError(400, 'Unknown voice');
        const name = app.persona.name;
        const text = lang === 'en' || lang === 'auto' ? `Hi, it's ${name}. This is how I'd sound if you pick this voice.` : `${name}.`;
        const dir = join(rootDir, 'cache', 'voice-samples');
        const file = join(dir, `${voiceId}-${lang}-${createHash('sha256').update(text).digest('hex').slice(0, 12)}.mp3`);
        let data: Buffer;
        if (existsSync(file)) data = readFileSync(file);
        else {
          const key = await xaiKey().catch(() => undefined);
          if (!key) throw new HttpError(400, 'Sign in to Grok first (Models → Subscriptions), or add an xAI key.');
          try {
            data = (await xaiSpeak({ voiceId, language: lang === 'auto' ? 'en' : lang }, key, text, 1)).data;
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, data);
        }
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': data.length, 'cache-control': 'private, max-age=86400', ...SECURITY_HEADERS });
        return void res.end(data);
      }
      if (b === 'openai-sample' && method === 'GET') {
        // Phase 48: a short sample of an OpenAI live-call voice, made with OpenAI's text-to-speech
        // (gpt-4o-mini-tts has the same voices as the Realtime API), on the key live calls use.
        const voiceId = new URL(req.url ?? '/', 'http://x').searchParams.get('voice') ?? '';
        if (!(OPENAI_LIVE_VOICES as readonly string[]).includes(voiceId)) throw new HttpError(400, 'Unknown voice');
        const text = `Hi, it's ${app.persona.name}. This is how I'd sound on a call if you pick this voice.`;
        const dir = join(rootDir, 'cache', 'voice-samples');
        const file = join(dir, `openai-${voiceId}-${createHash('sha256').update(text).digest('hex').slice(0, 12)}.mp3`);
        let data: Buffer;
        if (existsSync(file)) data = readFileSync(file);
        else {
          const k = speech.openaiRealtimeKey();
          if (!k) throw new HttpError(400, 'Add an OpenAI API key first (the speech API key below, or an OpenAI model provider).');
          try {
            data = (await openaiSpeak({ ...DEFAULT_VOICE.openai, baseUrl: 'https://api.openai.com/v1', ttsModel: 'gpt-4o-mini-tts', ttsVoice: voiceId }, k.key, text, 1)).data;
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, data);
        }
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': data.length, 'cache-control': 'private, max-age=86400', ...SECURITY_HEADERS });
        return void res.end(data);
      }
      if (b === 'xai-voices' && method === 'GET') {
        const key = await xaiKey().catch(() => undefined);
        if (!key) return send(res, 200, { voices: [] });
        return send(res, 200, { voices: await xaiVoices(key).catch(() => []) });
      }
      if (b === 'transcribe' && method === 'POST') {
        const audio = await readRaw(req, 15 * 1024 * 1024);
        try {
          const text = await speech.transcribe(audio);
          return send(res, 200, { text });
        } catch (err) {
          if (err instanceof VoiceError) throw new HttpError(400, err.message);
          throw err;
        }
      }
      if (b === 'speak' && method === 'POST') {
        const body = await readJson(req);
        // Phase 37: the raw text goes in (her *sighs* and "haha" become Grok voice's speech tags).
        const raw = String(body.text ?? '').slice(0, 2400);
        if (!speechText(raw)) throw new HttpError(400, 'Nothing to say');
        const level = ['off', 'subtle', 'lively'].includes(String(body.expressive)) ? (String(body.expressive) as Expressive) : undefined;
        const tone = ['natural', 'warm', 'bright', 'calm'].includes(String(body.tone)) ? (String(body.tone) as VoiceTone) : undefined;
        try {
          const audio = await speech.speak(raw, body.voice ? String(body.voice) : undefined, { expressive: level, tone });
          res.writeHead(200, { 'content-type': audio.type, 'content-length': audio.data.length, 'cache-control': 'no-store', ...SECURITY_HEADERS });
          return void res.end(audio.data);
        } catch (err) {
          if (err instanceof VoiceError) throw new HttpError(400, err.message);
          throw err;
        }
      }
    }

    // Phase 26: calls from her (Settings → Voice → Calls from her).
    if (a === 'calls' && app.calls) {
      const calls = app.calls;
      if (!b && method === 'GET') return send(res, 200, { rules: callRules(app), ring: calls.current ?? null });
      if (!b && method === 'PUT') {
        const body = await readJson(req);
        let next: CallRules;
        try {
          next = cleanCallRules(body, callRules(app));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        app.settings.update({ calls: next });
        return send(res, 200, { rules: next, ring: calls.current ?? null });
      }
      if (b === 'test' && method === 'POST') {
        // "Call me now" to try it: rings every signed-in app, rules aside (it's the owner asking).
        const body = await readJson(req);
        let conv = typeof body.conversationId === 'string' ? app.store.getConversation(body.conversationId) : undefined;
        conv ??= app.store.listConversations()[0] ?? app.store.createConversation({ title: 'Calls' });
        if (conv.partner) throw new HttpError(400, 'Not in a partner chat.');
        const out = calls.ring({ kind: 'test', reason: me('This is a test call from Sara, to check that calls reach you'), conversationId: conv.id });
        if ('skipped' in out) throw new HttpError(409, out.skipped);
        return send(res, 200, { ring: out.ring });
      }
      if (b && (c === 'decline' || c === 'cancel') && method === 'POST') {
        const ok = c === 'decline' ? calls.decline(safeDecode(b)) : calls.cancel(safeDecode(b));
        if (!ok) throw new HttpError(404, 'That call is no longer ringing.');
        return send(res, 200, { ok: true });
      }
    }

    // Phase 34: the personality studio. Everything here returns a draft; only PUT /api/persona saves.
    if (a === 'persona' && b === 'studio') {
      const owner = app.settings.get().ownerName?.trim() || 'the owner';
      const draftOf = (v: unknown): Persona => {
        try {
          return validatePersona(v ?? app.persona);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      };
      const tryIt = <T>(f: () => T): T => {
        try {
          return f();
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      };
      if (!c && method === 'GET') {
        return send(res, 200, {
          traits: TRAITS.map(({ id, label, group, low, high, tip, examples }) => ({ id, label, group, low, high, tip, examples })),
          humours: Object.entries(HUMOURS).map(([id, h]) => ({ id, label: h.label })),
          life: LIFE_FIELDS.map(({ id, label, placeholder }) => ({ id, label, placeholder })),
          archetypes: ARCHETYPES.map(({ id, emoji, label, blurb }) => ({ id, emoji, label, blurb })),
          talk: Object.entries(TALK).map(([id, t]) => ({ id, label: t.label })),
          relationships: Object.entries(RELATIONSHIPS).map(([id, r]) => ({ id, label: r.label })),
          scenarios: SCENARIOS.map(({ id, label, text, set }) => ({ id, label, text, set })),
          inCharacter: app.settings.get().persona?.inCharacter ?? 'off',
          // Phase 51: the "Quiet when I'm focused" switch (the work dials are in `traits`).
          quietFocus: { label: QUIET_FOCUS.label, tip: QUIET_FOCUS.tip },
          // Phase 35: you and her.
          relationshipTypes: Object.entries(RELATIONSHIPS).map(([id, r]) => ({ id, label: r.label, ...RELATIONSHIP_INFO[id] })),
          away: Object.entries(AWAY).map(([id, x]) => ({ id, label: x.label })),
          conflict: Object.entries(CONFLICT).map(([id, x]) => ({ id, label: x.label })),
          others: Object.entries(OTHERS).map(([id, x]) => ({ id, label: x.label })),
          otherCompanions: bondContext(app).otherCompanions,
          // Explicit levels: only with Adult mode on, and only offered in a web browser.
          intimacy: INTIMACY_LEVELS.filter((l) => !l.adult || (adultModeOn(app.settings.get()) && !fromSaraApp(req))).map(({ id, label, adult }) => ({ id, label, adult })),
        });
      }
      if (c === 'apply' && method === 'POST') {
        const body = await readJson(req);
        let p = draftOf(body.persona);
        if (body.archetype) p = tryIt(() => applyArchetype(p, String(body.archetype), owner));
        if (body.relationship) p = tryIt(() => applyRelationship(p, String(body.relationship), owner));
        if (body.talk) p = tryIt(() => applyTalk(p, String(body.talk), owner));
        return send(res, 200, { persona: p });
      }
      if (c === 'unique' && method === 'POST') return send(res, 200, { persona: makeUnique(draftOf((await readJson(req)).persona)) });
      if (c === 'surprise' && method === 'POST') {
        const body = await readJson(req);
        const pronouns = body.pronouns === 'he' || body.pronouns === 'they' ? body.pronouns : body.pronouns === 'she' ? 'she' : (app.persona.pronouns ?? 'she');
        return send(res, 200, { persona: tryIt(() => surprise({ name: String(body.name ?? '').slice(0, 40), pronouns, relationship: String(body.relationship ?? app.persona.relationship ?? ''), appearance: app.persona.appearance }, owner)) });
      }
      if (c === 'fill' && method === 'POST') {
        const body = await readJson(req);
        const p = draftOf(body.persona);
        return send(res, 200, body.write === true ? await fillLife(app, p) : { persona: fillLifeQuick(p), written: false });
      }
      if (c === 'try' && method === 'POST') {
        const body = await readJson(req);
        const only = Array.isArray(body.scenarios) ? body.scenarios.map(String) : undefined;
        // "Before" is how she was when the owner opened the page (settings save by themselves).
        const before = body.before && typeof body.before === 'object' ? draftOf(body.before) : app.persona;
        return send(res, 200, { samples: await trySamples(app, before, draftOf(body.persona), only, body.set === 'bond' ? 'bond' : body.set === 'work' ? 'work' : 'personality') });
      }
      if (c === 'check' && method === 'PUT') {
        const v = String((await readJson(req)).inCharacter);
        if (v !== 'off' && v !== 'some' && v !== 'every') throw new HttpError(400, 'Choose off, some or every');
        app.settings.update({ persona: { ...app.settings.get().persona, inCharacter: v } });
        return send(res, 200, { inCharacter: v });
      }
      if (c === 'drift' && method === 'GET') {
        const since = new Date(app.now().getTime() - 7 * 86_400_000).toISOString();
        return send(res, 200, { mode: app.settings.get().persona?.inCharacter ?? 'off', week: app.drift?.stats(since) ?? { checks: 0, average: null, drifted: 0 }, recent: app.drift?.recent(10) ?? [] });
      }
    }
    if (a === 'persona' && b === 'choices' && method === 'GET') {
      const pick = (o: Record<string, { label: string }>) => Object.entries(o).map(([id, v]) => ({ id, label: v.label }));
      return send(res, 200, { relationships: pick(RELATIONSHIPS), vibes: pick(VIBES), talk: pick(TALK) });
    }
    if (a === 'persona' && b === 'draft' && method === 'POST') {
      // A draft character from simple choices. Nothing is saved until the owner presses Save.
      const body = await readJson(req);
      const choices: CharacterChoices = {
        name: String(body.name ?? '').trim(),
        pronouns: body.pronouns === 'he' || body.pronouns === 'they' ? body.pronouns : 'she',
        age: Number(body.age) || 28,
        relationship: String(body.relationship ?? 'friend'),
        vibe: String(body.vibe ?? 'warm'),
        talk: String(body.talk ?? 'texting'),
        interests: String(body.interests ?? '').slice(0, 300),
        appearance: String(body.appearance ?? '').slice(0, 600),
        extra: String(body.extra ?? '').slice(0, 1000),
      };
      try {
        if (body.write === true) return send(res, 200, await writeCharacter(app, choices));
        return send(res, 200, { persona: quickCharacter(choices, app.settings.get().ownerName?.trim() || 'the owner'), written: false });
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }
    // Phase 21: the whole character as one file (name, personality, look, voice choice).
    if (a === 'character' && b === 'export' && method === 'GET') {
      const body = JSON.stringify(exportCharacter(app));
      const name = `${app.persona.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'character'}.sara-character.json`;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', ...SECURITY_HEADERS });
      return void res.end(body);
    }
    // Phase 57: character cards (SillyTavern / Character Card V2 and V3, PNG or JSON).
    if (a === 'character' && b === 'card') {
      if (opts.demo) throw new HttpError(403, 'Not in the demo.');
      if (c === 'preview' && method === 'POST') {
        const raw = await readRaw(req, MAX_CARD_PNG);
        if (!raw.length) throw new HttpError(400, 'Choose a character card (a PNG or JSON file).');
        if (!isPng(raw) && raw.length > MAX_CARD_JSON) throw new HttpError(413, 'The character card is too big (up to 2 MB).');
        let imp: CardImport;
        let png: Buffer | undefined;
        try {
          const parsed = parseCardFile(raw);
          // UX 25: the plain picture made when she had no portrait never replaces a real one.
          png = parsed.placeholder ? undefined : parsed.png;
          imp = cardToCharacter(parsed.card, { adultOn: adultModeOn(app.settings.get()), ownerName: app.settings.get().ownerName });
        } catch (err) {
          if (err instanceof CardError) throw new HttpError(400, err.message);
          throw err;
        }
        const now = Date.now();
        for (const [k, v] of cardDrafts) if (v.expires < now) cardDrafts.delete(k);
        while (cardDrafts.size >= 5) cardDrafts.delete(cardDrafts.keys().next().value!);
        const token = randomBytes(12).toString('base64url');
        cardDrafts.set(token, { imp, png, expires: now + 15 * 60_000 });
        const p = imp.persona;
        const cm = opts.companions;
        return send(res, 200, {
          token,
          preview: {
            name: p.name,
            pronouns: p.pronouns ?? 'she',
            age: p.age,
            summary: p.summary,
            personality: p.personality.slice(0, 6),
            greeting: imp.greeting.slice(0, 1200),
            tags: (imp.extras.tags as string[]).slice(0, 12),
            lore: imp.lore.length,
            nsfw: imp.check.nsfw,
            notes: imp.notes,
            picture: png && png.length <= MAX_AVATAR ? `data:image/png;base64,${png.toString('base64')}` : null,
            pictureTooBig: Boolean(png && png.length > MAX_AVATAR),
            canAdd: Boolean(cm?.build) && (cm?.all().length ?? 9) < 8 && !cm?.all().some((x) => x.app.persona.name.toLowerCase() === p.name.toLowerCase()),
          },
        });
      }
      if (c === 'import' && method === 'POST') {
        const body = await readJson(req);
        const d = cardDrafts.get(String(body.token ?? ''));
        if (!d) throw new HttpError(404, 'This preview has expired. Choose the card again.');
        const as = body.as === 'new' ? 'new' : 'this';
        let target = app;
        let created: string | null = null;
        if (as === 'new') {
          const cm = opts.companions;
          if (!cm?.build) throw new HttpError(400, 'More companions are not available on this server.');
          if (cm.all().length >= 8) throw new HttpError(400, 'Up to 8 companions on one server.');
          if (cm.all().some((x) => x.app.persona.name.toLowerCase() === d.imp.persona.name.toLowerCase())) throw new HttpError(400, 'There\'s already a companion called {name}.', { params: { name: d.imp.persona.name } });
          const { id, dir } = createCompanionDir(rootDir, d.imp.persona as unknown as Record<string, unknown>, app.now());
          try {
            const comp = cm.build(id, dir);
            cm.add(comp);
            comp.start();
            target = comp.app;
            created = id;
          } catch (err) {
            retireCompanionDir(rootDir, id, app.now());
            throw err;
          }
        } else {
          writeFileSync(join(app.dataDir, 'persona.json'), JSON.stringify(d.imp.persona, null, 2) + '\n', { mode: 0o600 });
          if (app.persona.name !== d.imp.persona.name) app.memory?.renameCompanion(app.persona.name, d.imp.persona.name);
          app.persona = d.imp.persona;
        }
        cardDrafts.delete(String(body.token));
        // Her picture: the card's PNG (the single uploaded picture, like Settings → Look → Upload).
        let picture = false;
        if (d.png && body.picture !== false && d.png.length <= MAX_AVATAR) {
          for (const ext of Object.keys(AVATAR_TYPES)) rmSync(join(target.dataDir, `avatar.${ext}`), { force: true });
          writeFileSync(join(target.dataDir, 'avatar.png'), d.png, { mode: 0o600 });
          picture = true;
        }
        // The lorebook: her own notes (replacing notes from an earlier card).
        let lore = 0;
        if (target.memory && d.imp.lore.length) {
          for (const m of target.memory.list({ kind: 'self', limit: 500 })) if (m.evidence?.startsWith('character card')) target.memory.delete(m.id);
          const day = localDate(target.now().toISOString(), target.settings.get().timeZone);
          for (const e of d.imp.lore) {
            target.memory.add({ kind: 'self', content: `${e.keys.length ? `${e.keys.slice(0, 4).join(', ')}: ` : ''}${e.content}`, conversationId: null, sourceMessageId: null, happenedOn: day, evidence: `character card: ${d.imp.persona.name}${e.name ? ` · ${e.name}` : ''}` });
            lore++;
          }
        }
        writeFileSync(join(target.dataDir, 'character-card.json'), JSON.stringify({ ...d.imp.extras, importedAt: app.now().toISOString() }, null, 2) + '\n', { mode: 0o600 });
        return send(res, 200, { persona: target.persona, companion: created, picture, lore });
      }
      if ((c === 'json' || c === 'png') && (method === 'GET' || (c === 'png' && method === 'POST'))) {
        let extras: Record<string, unknown> = {};
        try {
          const v = JSON.parse(readFileSync(join(app.dataDir, 'character-card.json'), 'utf8')) as unknown;
          if (v && typeof v === 'object' && !Array.isArray(v)) extras = v as Record<string, unknown>;
        } catch {
          /* no card imported before */
        }
        const card = personaToCard(app.persona, extras, app.now());
        const base = app.persona.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'character';
        if (c === 'json') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${base}.card.json"`, 'cache-control': 'no-store', ...SECURITY_HEADERS });
          return void res.end(JSON.stringify(card, null, 2));
        }
        // The picture: one the browser drew from her portrait (POST), her uploaded PNG, a PNG look, or a plain one.
        let picture: Buffer | undefined;
        if (method === 'POST') {
          picture = await readRaw(req, MAX_CARD_PNG);
          if (!isPng(picture)) throw new HttpError(400, 'Send a PNG picture.');
        } else {
          // UX 25: her real portrait as a PNG (her uploaded picture, her current look, or the
          // built-in portrait; JPEGs are converted), and only then a marked plain picture.
          const read = (file: string | undefined) => {
            try {
              return file ? readFileSync(file) : undefined;
            } catch {
              return undefined;
            }
          };
          const uploaded = avatarFile();
          picture = (uploaded ? portraitPng(read(uploaded)) : (portraitPng(read(app.look?.fileFor('sara-portrait.jpg'))) ?? portraitPng(read(join(webRoot, 'sara-portrait.jpg'))))) ?? placeholderPicture(app.persona.name);
        }
        let out: Buffer;
        try {
          out = cardPng(picture, card);
        } catch (err) {
          if (err instanceof CardError) throw new HttpError(400, err.message);
          throw err;
        }
        res.writeHead(200, { 'content-type': 'image/png', 'content-disposition': `attachment; filename="${base}.card.png"`, 'cache-control': 'no-store', ...SECURITY_HEADERS });
        return void res.end(out);
      }
    }
    if (a === 'character' && b === 'import' && method === 'POST') {
      const body = await readJson(req, MAX_CHARACTER);
      let c: ReturnType<typeof parseCharacter>;
      try {
        c = parseCharacter(body.file);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      const parts = { look: body.look !== false, voice: body.voice !== false };
      if (parts.look && c.look && !app.look) throw new HttpError(400, "This server can't show custom looks.");
      // Everything was checked above; now apply.
      const file = join(app.dataDir, 'persona.json');
      writeFileSync(file, JSON.stringify(c.persona, null, 2) + '\n', { mode: 0o600 });
      const renamed = app.persona.name !== c.persona.name ? (app.memory?.renameCompanion(app.persona.name, c.persona.name) ?? 0) : 0;
      app.persona = c.persona;
      let lookDone = false;
      if (parts.look && app.look) {
        try {
          if (c.look) app.look.importFiles(c.look, app.now());
          else app.look.reset(); // the file has the default look
          lookDone = true;
        } catch (err) {
          throw new HttpError(409, 'Her name and personality were imported, but not the look: {error}', { params: { error: (err as Error).message } });
        }
      }
      if (parts.voice && c.voice) app.settings.update({ voice: withCharacterVoice(app, c.voice) });
      return send(res, 200, { persona: c.persona, look: lookDone, voice: Boolean(parts.voice && c.voice), renamedMemories: renamed });
    }
    if (a === 'persona' && !b) {
      const file = join(app.dataDir, 'persona.json');
      if (method === 'GET') return send(res, 200, { persona: app.persona, custom: existsSync(file), safetyBoundaries: SAFETY_BOUNDARIES });
      if (method === 'PUT') {
        let p: Persona;
        try {
          p = validatePersona(await readJson(req));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        // Phase 35: choosing an explicit intimacy level needs Adult mode, from a web browser.
        const level = p.intimacy?.level;
        if (level && intimacyLevel(level)?.adult && level !== app.persona.intimacy?.level) {
          if (fromSaraApp(req)) throw new HttpError(403, 'Explicit levels can only be chosen in a web browser.');
          if (!adultModeOn(app.settings.get())) throw new HttpError(403, 'Explicit levels need Adult mode: turn it on first (Settings → You → Adult mode, in a web browser).');
        }
        const saved = savePersona(app, p);
        return send(res, 200, { persona: p, custom: true, renamedMemories: saved.renamedMemories });
      }
      if (method === 'DELETE') {
        if (!app.defaultPersonaPath) throw new HttpError(404, 'No default character');
        rmSync(file, { force: true });
        app.persona = loadPersona(app.defaultPersonaPath);
        return send(res, 200, { persona: app.persona, custom: false });
      }
    }

    // Phase 14: the phone app's home-screen widget (her face, mood, last message) and its
    // notification check (her messages that arrived on their own, after a given id).
    if (a === 'today' && !b && method === 'GET') return send(res, 200, await buildToday(app, { fresh: new URL(req.url ?? '/', 'http://x').searchParams.has('fresh') }));
    if (a === 'phone' && b === 'widget' && method === 'GET') {
      const s = app.settings.get();
      const now = app.now();
      const st = app.inner && s.persona?.innerLife !== false ? app.inner.get(now) : undefined;
      const expression = st ? expressionFor(st, now, s.timeZone, leansPlayful(app.persona.traits)) : 'default';
      const last = app.store.db
        .prepare("SELECT m.id, m.conversation_id, m.content, m.created_at FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'assistant' AND c.partner IS NULL AND m.content != '' AND (m.meta IS NULL OR m.meta NOT LIKE '%\"importedFrom\"%') ORDER BY m.id DESC LIMIT 1")
        .get() as { id: number; conversation_id: string; content: string; created_at: string } | undefined;
      return send(res, 200, {
        name: app.persona.name,
        ...(st ? { mood: moodLabel(st, now, s.timeZone).mood } : {}),
        face: expression === 'default' ? '/sara-portrait.jpg' : `/sara/portrait-${expression}.jpg`,
        ...(last ? { last: { id: last.id, conversationId: last.conversation_id, text: last.content.replace(/\s+/g, ' ').slice(0, 200), at: last.created_at } } : {}),
      });
    }
    if (a === 'phone' && b === 'inbox' && method === 'GET') {
      const after = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('after') ?? 0) || 0;
      const rows = app.store.db
        .prepare(
          "SELECT m.id, m.conversation_id, m.content, m.created_at, m.meta FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'assistant' AND c.partner IS NULL AND m.id > ? AND (m.meta LIKE '%\"proactive\"%' OR m.meta LIKE '%\"reminder\"%' OR m.meta LIKE '%\"job\"%' OR m.meta LIKE '%\"briefing\"%' OR m.meta LIKE '%\"background\"%') ORDER BY m.id DESC LIMIT 5",
        )
        .all(after) as { id: number; conversation_id: string; content: string; created_at: string; meta: string | null }[];
      const latest = (app.store.db.prepare('SELECT MAX(id) AS n FROM messages').get() as { n: number | null }).n ?? 0;
      const kind = (meta: string | null) => (meta?.includes('"reminder"') ? 'reminder' : meta?.includes('"job"') ? 'job' : 'message');
      return send(res, 200, { latest, name: app.persona.name, messages: rows.reverse().map((r) => ({ id: r.id, conversationId: r.conversation_id, text: r.content.slice(0, 500), at: r.created_at, kind: kind(r.meta) })) });
    }

    if (a === 'sara' && b === 'state' && method === 'GET') {
      const s = app.settings.get();
      const now = app.now();
      if (!app.inner || s.persona?.innerLife === false) return send(res, 200, { enabled: false });
      const st = app.inner.get(now);
      const today = localDate(now.toISOString(), s.timeZone);
      return send(res, 200, { enabled: true, ...moodLabel(st, now, s.timeZone), expression: expressionFor(st, now, s.timeZone, leansPlayful(app.persona.traits)), customAvatar: Boolean(avatarFile()), closeness: Math.round(st.closeness * 100) / 100, day: app.life?.get(today) ?? null, today });
    }
    // Phase 12: her ongoing life threads (owner can see, edit, add and remove them).
    if (a === 'sara' && b === 'threads') {
      const life = app.life;
      if (!life) throw new HttpError(404, 'Not available');
      const today = localDate(app.now().toISOString(), app.settings.get().timeZone);
      const id = Number(c);
      if (!c && method === 'GET') return send(res, 200, life.threads());
      if (!c && method === 'POST') {
        const body = await readJson(req);
        const title = String(body.title ?? '').replace(/\s+/g, ' ').trim();
        if (title.length < 3 || title.length > 200) throw new HttpError(400, 'Describe it in 3 to 200 characters.');
        if (detectMinorSexualContent(title)) throw new HttpError(400, 'Not allowed.');
        return send(res, 201, life.addThread(title, today, { byOwner: true }));
      }
      if (Number.isInteger(id) && method === 'PATCH') {
        const body = await readJson(req);
        const title = body.title === undefined ? undefined : String(body.title).replace(/\s+/g, ' ').trim();
        if (title !== undefined && (title.length < 3 || title.length > 200)) throw new HttpError(400, 'Describe it in 3 to 200 characters.');
        const status = body.status === 'done' || body.status === 'active' ? body.status : undefined;
        const t = life.updateThread(id, { ...(title ? { title } : {}), ...(status ? { status } : {}) });
        if (!t) throw new HttpError(404, 'Not found');
        return send(res, 200, t);
      }
      if (Number.isInteger(id) && method === 'DELETE') {
        if (!life.deleteThread(id)) throw new HttpError(404, 'Not found');
        return send(res, 200, { ok: true });
      }
    }
    // Phase 37: things to do together, and the shared lists.
    if (a === 'together' && app.together) {
      const tg = app.together;
      const view = () => ({ activities: ACTIVITIES.map(({ id, label, emoji, blurb, start, topic }) => ({ id, label, emoji, blurb, start, topic: topic ?? null })), lists: Object.entries(LISTS).map(([id, l]) => ({ id, ...l })), items: tg.items() });
      if (!b && method === 'GET') return send(res, 200, view());
      if (b === 'items' && !c && method === 'POST') {
        const body = await readJson(req);
        try {
          tg.add(String(body.list ?? '') as ListId, String(body.title ?? ''), typeof body.note === 'string' ? body.note : null, 'owner');
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        return send(res, 200, view());
      }
      const id = Number(c);
      if (b === 'items' && Number.isInteger(id)) {
        if (method === 'PUT') {
          const body = await readJson(req);
          if (!tg.setDone(id, body.done !== false)) throw new HttpError(404, 'Not found');
          return send(res, 200, view());
        }
        if (method === 'DELETE') {
          if (!tg.remove(id)) throw new HttpError(404, 'Not found');
          return send(res, 200, view());
        }
      }
    }
    if (a === 'look') {
      const look = app.look;
      if (!look) throw new HttpError(404, 'Not available');
      // Phase 36: adults-only looks are listed only with Adult mode on, and never in the apps.
      const adultOk = () => adultModeOn(app.settings.get()) && !fromSaraApp(req);
      const view = async () => {
        const w = wardrobeSettings(app);
        const plan = await app.wardrobe?.plan().catch(() => undefined);
        return {
          custom: look.custom,
          missing: look.missingFrames().length,
          status: look.status,
          hasDraft: Boolean(look.draftBytes()),
          draft: look.draftBytes() ? look.draftMeta() : null,
          styles: Object.keys(LOOK_STYLES),
          uploaded: Boolean(avatarFile()),
          outfits: Object.entries(OUTFITS).map(([id, o]) => ({ id, label: o.label })),
          places: Object.entries(PLACES).map(([id, o]) => ({ id, label: o.label })),
          parts: Object.entries(PARTS).map(([id, o]) => ({ id, label: o.label, options: o.options ?? [] })),
          saved: look.saved().filter((x) => adultOk() || !x.adult),
          current: look.currentSavedId() ?? null,
          wearing: look.custom ? look.currentMeta() : {},
          faceLock: app.settings.get().faceLock !== false,
          hasFace: Boolean(look.faceRef()) || existsSync(look.faceFile),
          wardrobe: { ...w, manual: w.manual && Date.parse(w.manual.until) > app.now().getTime() ? w.manual : undefined },
          scenarios: allScenarios(w),
          active: plan?.active ?? [],
          pick: plan?.pick ? { id: plan.pick.look.id, name: plan.pick.look.name, scenario: plan.pick.scenario } : null,
          last: app.wardrobe?.last ?? null,
        };
      };
      if (!b && method === 'GET') return send(res, 200, await view());
      if (!b && method === 'DELETE') {
        look.reset();
        return send(res, 200, await view());
      }
      if (b === 'draft' && method === 'POST') {
        const body = await readJson(req);
        const appearance = String(body.appearance ?? '');
        if (/\b(child|kid|minor|teen|underage|toddler|1[0-7] ?(yo|years? old))\b/i.test(appearance)) throw new HttpError(400, 'The look must be an adult.');
        look.draft(appearance, String(body.style ?? 'illustrated')).catch(() => {});
        return send(res, 202, await view());
      }
      if (b === 'complete' && method === 'POST') {
        look.complete().catch(() => {});
        return send(res, 202, await view());
      }
      // Phase 21: the current look in another outfit (a draft to accept like any other).
      // Phase 36: optionally somewhere else too; adults-only outfits need Adult mode (web only).
      if ((b === 'outfit' || b === 'tweak' || b === 'place') && method === 'POST') {
        const body = await readJson(req);
        if (look.status.state === 'drafting' || look.status.state === 'building') throw new HttpError(409, 'A picture is already being made.');
        const current = readFileSync(look.fileFor('sara-portrait.jpg') ?? join(webRoot, 'sara-portrait.jpg'));
        try {
          if (b === 'outfit') {
            const outfit = String(body.outfit ?? '').trim();
            const wear = outfitPrompt(outfit);
            if (isAdultOutfit(wear) && !adultOk()) throw new Error(fromSaraApp(req) ? 'Adults-only outfits can only be made in a web browser.' : 'That outfit is adults-only: turn on Adult mode first (Settings → You → Adult mode, in a web browser).');
            const place = typeof body.place === 'string' && body.place ? body.place.slice(0, 200) : undefined;
            if (place && /\b(child|kid|minor|teen|school)\b/i.test(place)) throw new Error('Pick another place.');
            look.outfit(current, outfit, { place, adultOk: adultOk() }).catch(() => {});
          } else if (b === 'tweak') {
            const part = String(body.part ?? '');
            const value = String(body.value ?? '');
            if (!PARTS[part]) throw new Error('Pick what to change.');
            if (!value.trim()) throw new Error('Say how to change it.');
            if (isAdultOutfit(value) && !adultOk()) throw new Error('That change is adults-only: it needs Adult mode (in a web browser).');
            look.tweak(current, part, value).catch(() => {});
          } else {
            const place = String(body.place ?? '').trim();
            if (!place) throw new Error('Pick a place.');
            look.place(current, place).catch(() => {});
          }
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        return send(res, 202, await view());
      }
      // Phase 36: face lock and the closet (scenarios per look, dress automatically).
      if (b === 'face-lock' && method === 'PUT') {
        const body = await readJson(req);
        app.settings.update({ faceLock: body.on !== false });
        return send(res, 200, await view());
      }
      if (b === 'wardrobe' && !c && method === 'PUT') {
        const body = await readJson(req);
        try {
          app.settings.update({ wardrobe: cleanWardrobe(body as Partial<WardrobeSettings>, wardrobeSettings(app)) });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        await app.wardrobe?.tick().catch(() => undefined);
        return send(res, 200, await view());
      }
      if (b === 'wardrobe' && c === 'now' && (method === 'POST' || method === 'DELETE')) {
        const body = method === 'POST' ? await readJson(req) : {};
        const w = wardrobeSettings(app);
        if (method === 'DELETE') app.settings.update({ wardrobe: { ...w, manual: undefined } });
        else {
          const sc = String(body.scenario ?? '');
          if (!allScenarios(w).some((x) => x.id === sc)) throw new HttpError(400, 'Pick a scenario.');
          const hours = Math.min(24, Math.max(1, Number(body.hours) || 4));
          app.settings.update({ wardrobe: { ...w, manual: { scenario: sc, until: new Date(app.now().getTime() + hours * 3600_000).toISOString() } } });
        }
        await app.wardrobe?.tick().catch(() => undefined);
        return send(res, 200, await view());
      }
      // Phase 21: saved looks.
      if (b === 'saved' && !c && method === 'POST') {
        const body = await readJson(req);
        try {
          look.save(String(body.name ?? ''), app.now());
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        return send(res, 200, await view());
      }
      const sv = /^saved\/([a-f0-9]{12})(\/use|\/meta|\.jpg)?$/.exec(parts.slice(1).join('/'));
      if (sv) {
        if (sv[2] === '/meta' && method === 'PUT') {
          const body = (await readJson(req)) as LookMeta;
          if (body.adult === false && look.saved().find((x) => x.id === sv[1])?.adult && !adultOk()) throw new HttpError(403, 'Change adults-only looks in a web browser with Adult mode on.');
          try {
            look.setMeta(sv[1], cleanMeta(body));
          } catch (err) {
            throw new HttpError(404, (err as Error).message);
          }
          return send(res, 200, await view());
        }
        try {
          if (!sv[2] && method === 'DELETE') {
            look.deleteSaved(sv[1]);
            return send(res, 200, await view());
          }
          if (sv[2] === '/use' && method === 'POST') {
            const target = look.saved().find((x) => x.id === sv[1]);
            if (target?.adult && !adultOk()) throw new Error('This look is adults-only: it needs Adult mode (in a web browser).');
            look.use(sv[1], app.now());
            app.events?.publish({ type: 'look' });
            if (look.missingFrames().length) void look.complete().catch(() => {});
            return send(res, 200, await view());
          }
          if (sv[2] === '.jpg' && method === 'GET') {
            const f = look.savedPortrait(sv[1]);
            const img = readFileSync(f);
            res.writeHead(200, { 'content-type': img[0] === 0x89 ? 'image/png' : 'image/jpeg', 'cache-control': 'private, max-age=3600', ...SECURITY_HEADERS });
            return void res.end(img);
          }
        } catch (err) {
          throw new HttpError(404, (err as Error).message);
        }
      }
      if (b === 'draft.jpg' && method === 'GET') {
        const img = look.draftBytes();
        if (!img) throw new HttpError(404, 'No draft');
        res.writeHead(200, { 'content-type': img[0] === 0x89 ? 'image/png' : 'image/jpeg', 'cache-control': 'no-store', ...SECURITY_HEADERS });
        return void res.end(img);
      }
      if (b === 'build' && method === 'POST') {
        const body = await readJson(req);
        let base: Buffer | undefined;
        if (body.from === 'upload') {
          const f = avatarFile();
          if (!f) throw new HttpError(400, 'Upload a picture first.');
          if (body.consent !== true) throw new HttpError(400, 'Confirm the picture is AI-made, of you, or used with permission.');
          base = readFileSync(f);
        } else base = look.draftBytes();
        if (!base) throw new HttpError(400, 'Make a picture first.');
        const fromUpload = body.from === 'upload';
        look
          .build(base, fromUpload ? { newFace: true, place: 'room' } : undefined)
          .then(() => {
            // The full set replaces the single uploaded picture.
            if (fromUpload) for (const ext of Object.keys(AVATAR_TYPES)) rmSync(join(app.dataDir, `avatar.${ext}`), { force: true });
          })
          .catch(() => {});
        return send(res, 202, await view());
      }
    }
    if (a === 'sara' && b === 'avatar') {
      if (method === 'GET') {
        const f = avatarFile();
        if (!f) throw new HttpError(404, 'No custom picture');
        res.writeHead(200, { 'content-type': AVATAR_TYPES[extname(f).slice(1)], 'cache-control': 'no-cache', ...SECURITY_HEADERS });
        return void createReadStream(f).pipe(res);
      }
      if (method === 'PUT') {
        const data = await readRaw(req, MAX_AVATAR);
        const kind = data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg' : data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
        if (!kind) throw new HttpError(400, 'Use a JPEG, PNG or WebP picture.');
        for (const ext of Object.keys(AVATAR_TYPES)) rmSync(join(app.dataDir, `avatar.${ext}`), { force: true });
        writeFileSync(join(app.dataDir, `avatar.${kind}`), data, { mode: 0o600 });
        return send(res, 200, { customAvatar: true });
      }
      if (method === 'DELETE') {
        for (const ext of Object.keys(AVATAR_TYPES)) rmSync(join(app.dataDir, `avatar.${ext}`), { force: true });
        return send(res, 200, { customAvatar: false });
      }
    }
    if (a === 'sara' && b === 'day' && method === 'DELETE') {
      // Lets the owner make her "re-live" today (a new day note is written on the next tick).
      const s = app.settings.get();
      app.life?.delete(localDate(app.now().toISOString(), s.timeZone));
      return send(res, 200, { ok: true });
    }

    if (a === 'export' && !b && method === 'GET') {
      const body = JSON.stringify(exportAll(app), null, 1);
      const name = `sara-export-${app.now().toISOString().slice(0, 10)}.json`;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', ...SECURITY_HEADERS });
      return void res.end(body);
    }
    if (a === 'import' && !b && method === 'POST') {
      if (active.size) throw new HttpError(409, me('Wait until Sara finishes what she is doing, then import.'), { errorKey: 'Wait until Sara finishes what she is doing, then import.' });
      const body = await readJson(req, MAX_IMPORT);
      try {
        return send(res, 200, importAll(app, body));
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }

    if (a === 'planner' && !b && method === 'GET') {
      const pl = needPlanner();
      return send(res, 200, { projects: pl.projects(true), tasks: pl.tasks({ status: 'all' }), reminders: pl.reminders({ status: 'pending' }), recentReminders: pl.reminders({ status: 'sent', limit: 20 }), places: pl.places(), timeZone: app.settings.get().timeZone ?? null });
    }
    if (a === 'tasks') {
      const pl = needPlanner();
      if (!b && method === 'POST') {
        const body = await readJson(req);
        const title = String(body.title ?? '').trim();
        if (!title || title.length > 300) throw new HttpError(400, 'Task title must be 1-300 characters');
        const t = pl.addTask({ title, project: body.project ? String(body.project) : null, notes: body.notes ? String(body.notes) : '', priority: validPriority(body.priority), dueAt: whenOrNull(body.due, 17) });
        app.events?.publish({ type: 'planner', what: 'tasks' });
        return send(res, 201, t);
      }
      const id = Number(b);
      if (b && method === 'PATCH') {
        const body = await readJson(req);
        const t = pl.updateTask(id, {
          ...(body.title !== undefined ? { title: String(body.title) } : {}),
          ...(body.project !== undefined ? { project: body.project ? String(body.project) : null } : {}),
          ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
          ...(body.priority !== undefined ? { priority: validPriority(body.priority) } : {}),
          ...(body.due !== undefined ? { dueAt: whenOrNull(body.due, 17) } : {}),
          ...(body.status !== undefined ? { status: body.status === 'done' ? 'done' : 'open' } : {}),
        });
        if (!t) throw new HttpError(404, 'Task not found');
        app.events?.publish({ type: 'planner', what: 'tasks' });
        return send(res, 200, t);
      }
      if (b && method === 'DELETE') {
        if (!pl.deleteTask(id)) throw new HttpError(404, 'Task not found');
        app.events?.publish({ type: 'planner', what: 'tasks' });
        return send(res, 200, { ok: true });
      }
    }
    if (a === 'projects' && !b) {
      const pl = needPlanner();
      if (method === 'GET') {
        const convs = app.store.listConversations();
        return send(res, 200, pl.projects(true).map((p) => ({ ...p, conversations: convs.filter((c) => c.projectId === p.id).length })));
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const name = String(body.name ?? '').trim();
        if (!name) throw new HttpError(400, 'Give the project a name.');
        let id: number;
        try {
          id = pl.projectId(name)!;
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        const p = pl.updateProject(id, { ...(body.workspace ? { workspace: validWorkspace(body.workspace) } : {}), status: 'active' });
        app.events?.publish({ type: 'planner', what: 'tasks' });
        return send(res, 201, p);
      }
    }
    if (a === 'projects' && b) {
      const pl = needPlanner();
      const id = Number(b);
      // Project page: everything that belongs to one project.
      if (method === 'GET' && !c) {
        const p = pl.projects(true).find((x) => x.id === id);
        if (!p) throw new HttpError(404, 'Project not found');
        const conversations = app.store.listConversations().filter((cv) => cv.projectId === id);
        const tasks = pl.tasks({ status: 'all', projectId: id });
        const notes = pl.notes().filter((n) => n.projectId === id);
        let files: { path: string; size: number; modifiedAt: string }[] = [];
        let truncated = false;
        if (p.workspace) {
          try {
            ({ files, truncated } = listFiles(workspaceDir(rootDir, p.workspace), 300));
          } catch {
            files = [];
          }
        }
        return send(res, 200, { project: p, conversations, tasks, notes, files, filesTruncated: truncated });
      }
      if (method === 'PATCH') {
        const body = await readJson(req);
        const p = pl.updateProject(id, {
          ...(body.workspace !== undefined ? { workspace: body.workspace ? validWorkspace(body.workspace) : null } : {}),
          ...(body.name !== undefined ? { name: String(body.name).slice(0, 80) } : {}),
          ...(body.description !== undefined ? { description: String(body.description).slice(0, 2000) } : {}),
          ...(body.status !== undefined ? { status: body.status === 'archived' ? 'archived' : 'active' } : {}),
        });
        if (!p) throw new HttpError(404, 'Project not found');
        return send(res, 200, p);
      }
      if (method === 'DELETE') {
        // Its conversations and to-dos stay; they just lose the project.
        const moved = app.store.clearProject(id);
        if (!pl.deleteProject(id)) throw new HttpError(404, 'Project not found');
        app.events?.publish({ type: 'planner', what: 'tasks' });
        return send(res, 200, { ok: true, moved });
      }
    }
    // Phase 29: saved places and place reminders. The phone watches the places and reports only
    // "arrived at / left place N", never where it is.
    if (a === 'places') {
      const pl = needPlanner();
      if (!b && method === 'GET') return send(res, 200, { places: pl.places() });
      if (b === 'watch' && method === 'GET') return send(res, 200, { places: pl.watchedPlaces().map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, radius: p.radius, events: p.events })) });
      if (!b && method === 'POST') {
        const body = await readJson(req);
        let place;
        try {
          place = pl.savePlace({ name: String(body.name ?? ''), lat: Number(body.lat), lon: Number(body.lon), radius: body.radius === undefined ? undefined : Number(body.radius) });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        app.events?.publish({ type: 'planner', what: 'reminders' });
        return send(res, 201, place);
      }
      if (b === 'lookup' && method === 'POST') {
        // An address typed by the owner, looked up on OpenStreetMap (only when they ask).
        const body = await readJson(req);
        const q = String(body.address ?? '').trim();
        if (!q || q.length > 200) throw new HttpError(400, 'Type an address or place name (up to 200 characters).');
        const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'jsonv2', limit: '5', q })}`, { headers: { 'user-agent': 'Sara self-hosted companion (place reminders)', accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
        if (!r?.ok) throw new HttpError(502, 'Could not reach OpenStreetMap to look that up. Try again, or save the place from the phone app.');
        const found = ((await r.json()) as { display_name?: string; lat?: string; lon?: string }[]).map((x) => ({ label: String(x.display_name ?? '').slice(0, 160), lat: Number(x.lat), lon: Number(x.lon) })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
        return send(res, 200, { found });
      }
      const id = Number(b);
      if (b && Number.isInteger(id) && !c && method === 'DELETE') {
        if (!pl.deletePlace(id)) throw new HttpError(404, 'No such place.');
        app.events?.publish({ type: 'planner', what: 'reminders' });
        return send(res, 200, { ok: true });
      }
      if (b && Number.isInteger(id) && c === 'event' && method === 'POST') {
        const body = await readJson(req);
        const event = body.event === 'leave' ? 'leave' : 'arrive';
        if (!pl.place(id)) throw new HttpError(404, 'No such place.');
        const delivered = (app.reminders ?? new ReminderScheduler(app, pl)).atPlace(id, event);
        return send(res, 200, { delivered });
      }
    }
    if (a === 'reminders') {
      const pl = needPlanner();
      if (!b && method === 'POST') {
        const body = await readJson(req);
        const text = String(body.text ?? '').trim();
        if (!text || text.length > 500) throw new HttpError(400, 'Reminder text must be 1-500 characters');
        const byPlace = body.placeId !== undefined && body.placeId !== null && body.placeId !== '';
        const due = byPlace ? PLACE_DUE : whenOrNull(body.when);
        if (!due) throw new HttpError(400, 'When should the reminder go off?');
        const repeat = String(body.repeat ?? 'none') as Repeat;
        if (!REPEATS.includes(repeat)) throw new HttpError(400, 'repeat must be one of {list}', { params: { list: REPEATS.join(', ') } });
        const convId = body.conversationId ? String(body.conversationId) : null;
        const placeId = body.placeId === undefined || body.placeId === null || body.placeId === '' ? undefined : Number(body.placeId);
        if (placeId !== undefined && !pl.place(placeId)) throw new HttpError(400, 'That place no longer exists.');
        const r = pl.addReminder({ text, dueAt: due, repeat, conversationId: convId && app.store.getConversation(convId) ? convId : null, call: body.call === true, ...(placeId !== undefined ? { place: { id: placeId, event: body.placeEvent === 'leave' ? 'leave' : 'arrive' } } : {}) });
        app.events?.publish({ type: 'planner', what: 'reminders' });
        return send(res, 201, r);
      }
      if (b && method === 'DELETE') {
        if (!pl.cancelReminder(Number(b))) throw new HttpError(404, 'No upcoming reminder with that id');
        app.events?.publish({ type: 'planner', what: 'reminders' });
        return send(res, 200, { ok: true });
      }
    }
    if (a === 'notes') {
      const pl = needPlanner();
      if (!b && method === 'GET') return send(res, 200, pl.notes(new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? undefined));
      if ((!b && method === 'POST') || (b && method === 'PATCH')) {
        const body = await readJson(req);
        const text = String(body.body ?? '');
        if (!text.trim() || text.length > 50_000) throw new HttpError(400, 'Note must be 1-50,000 characters');
        const title = String(body.title ?? '').trim().slice(0, 120) || text.split('\n')[0].slice(0, 120);
        if (b && !pl.note(Number(b))) throw new HttpError(404, 'Note not found');
        const n = pl.saveNote({ ...(b ? { id: Number(b) } : {}), title, body: text, ...(body.project !== undefined ? { project: body.project ? String(body.project) : null } : {}) });
        app.events?.publish({ type: 'planner', what: 'notes' });
        return send(res, b ? 200 : 201, n);
      }
      if (b && method === 'DELETE') {
        if (!pl.deleteNote(Number(b))) throw new HttpError(404, 'Note not found');
        app.events?.publish({ type: 'planner', what: 'notes' });
        return send(res, 200, { ok: true });
      }
    }

    if (a === 'memories' || a === 'memory') {
      const mem = app.memory;
      if (!mem) throw new HttpError(404, 'Memory is not available');
      if (a === 'memory' && b === 'settings') {
        if (method === 'GET') return send(res, 200, { ...memorySettings(app), sharing: app.settings.get().memorySharing ?? 'own' });
        if (method === 'PUT') {
          const body = await readJson(req);
          const cur = memorySettings(app);
          const next: MemorySettings = {
            enabled: body.enabled === undefined ? cur.enabled : Boolean(body.enabled),
            quietMinutes: body.quietMinutes === undefined ? cur.quietMinutes : Math.min(1440, Math.max(1, Math.round(Number(body.quietMinutes) || cur.quietMinutes))),
            injectBudgetChars: body.injectBudgetChars === undefined ? cur.injectBudgetChars : Math.min(6000, Math.max(200, Math.round(Number(body.injectBudgetChars) || cur.injectBudgetChars))),
            fade: body.fade === 'slow' || body.fade === 'normal' || body.fade === 'never' ? body.fade : (cur.fade ?? 'never'),
          };
          app.settings.update({ memory: { ...next, budgetMoved: true } as MemorySettings, ...(body.sharing === 'shared' || body.sharing === 'own' ? { memorySharing: body.sharing } : {}) });
          return send(res, 200, { ...next, sharing: app.settings.get().memorySharing ?? 'own' });
        }
      }
      if (a === 'memories') {
        const view = (m: Memory) => {
          const conv = m.conversationId ? app.store.getConversation(m.conversationId) : undefined;
          // Phase 51: notes learned from imported history say so ("from your ChatGPT history").
          return { ...m, source: conv ? { conversationId: conv.id, title: conv.title, messageId: m.sourceMessageId, fromId: m.sourceFromId } : null, importedFrom: importedName(conv?.channel) ?? null };
        };
        if (!b && method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://x');
          const kind = url.searchParams.get('kind');
          return send(res, 200, mem.list({ kind: MEMORY_KINDS.includes(kind as MemoryKind) ? (kind as MemoryKind) : undefined, q: url.searchParams.get('q') ?? undefined }).map(view));
        }
        // Phase 12: tell her something to remember, or a date that matters, yourself.
        if (!b && method === 'POST') {
          const body = await readJson(req);
          const kind: MemoryKind = body.kind === 'date' || body.kind === 'decision' || body.kind === 'promise' || body.kind === 'milestone' ? body.kind : 'fact';
          const content = String(body.content ?? '').trim();
          if (content.length < 3 || content.length > 500) throw new HttpError(400, 'Write 3 to 500 characters.');
          const onDate = kind === 'date' ? String(body.onDate ?? '') : null;
          if (kind === 'date' && !parseOnDate(onDate)) throw new HttpError(400, 'Pick a real date.');
          const s2 = app.settings.get();
          const m = mem.add({ kind, content, onDate, conversationId: null, sourceMessageId: null, happenedOn: localDate(app.now().toISOString(), s2.timeZone), evidence: 'You added this.' });
          return send(res, 201, view(m));
        }
        if (b === 'upcoming' && method === 'GET') {
          const today = localDate(app.now().toISOString(), app.settings.get().timeZone);
          return send(res, 200, mem.upcoming(today, 60).map((u) => ({ ...view(u.memory), inDays: u.inDays, date: u.date, years: u.years })));
        }
        if (b === 'reflect' && method === 'POST') {
          if (!app.weekly) throw new HttpError(404, 'Not available');
          const result = await app.weekly.reflect(true);
          return send(res, 200, { result });
        }
        const id = Number(b);
        if (!Number.isInteger(id)) throw new HttpError(404, 'Not found');
        if (!c && method === 'PATCH') {
          const body = await readJson(req);
          const cur = mem.get(id);
          if (!cur) throw new HttpError(404, 'Memory not found');
          // "Use it again" for a fact the weekly look-back marked as replaced.
          if (body.supersededBy === null) mem.supersede(id, null);
          // Phase 32: mark a promise kept (or open again).
          if (body.resolved !== undefined && cur.kind === 'promise') mem.resolve(id, body.resolved ? app.now().toISOString() : (null as unknown as string));
          const content = body.content === undefined ? cur.content : String(body.content ?? '').trim();
          if (!content || content.length > 2000) throw new HttpError(400, 'Memory text must be 1-2000 characters');
          let onDate: string | undefined;
          if (body.onDate !== undefined && cur.kind === 'date') {
            onDate = String(body.onDate);
            if (!parseOnDate(onDate)) throw new HttpError(400, 'Pick a real date.');
          }
          const m = (body.content === undefined && onDate === undefined ? mem.get(id) : mem.update(id, content, onDate)) ?? cur;
          return send(res, 200, view(m));
        }
        if (!c && method === 'DELETE') {
          if (!mem.delete(id)) throw new HttpError(404, 'Memory not found');
          return send(res, 200, { ok: true });
        }
        if (c === 'forget' && method === 'POST') {
          const r = forgetMemory(app, mem, id);
          if (!r) throw new HttpError(404, 'Memory not found');
          return send(res, 200, r);
        }
      }
    }

    if (a === 'workspaces' && b && c === 'snapshots') {
      const ws = validWorkspace(b);
      const id = parts[3];
      if (!id && method === 'GET') return send(res, 200, app.snapshots.list(ws));
      if (id && parts[4] === 'restore' && method === 'POST') {
        const busy = [...active.keys()].some((cid) => app.store.getConversation(cid)?.workspace === ws);
        if (busy) throw new HttpError(409, me('Sara is working in this workspace. Stop her or wait before undoing.'), { errorKey: 'Sara is working in this workspace. Stop her or wait before undoing.' });
        const body = await readJson(req);
        let result;
        try {
          result = app.snapshots.restore(ws, workspaceDir(rootDir, ws), id);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        const target = app.snapshots.list(ws).find((s) => s.id === id);
        const convId = body.conversationId ? String(body.conversationId) : undefined;
        if (convId && app.store.getConversation(convId)) {
          app.store.addMessage(
            convId,
            'notice',
            `restore:The owner restored workspace "${ws}" to before: ${target?.label ?? id}. Changes made after that point were undone (${result.restored} files restored, ${result.removed} removed).`,
          );
        }
        return send(res, 200, { ...result, target });
      }
    }

    // Phase 13: what changed in a workspace repository (project page). Read only.
    if (a === 'workspaces' && b && c === 'git' && method === 'GET') {
      const ws = validWorkspace(b);
      const dir = workspaceDir(rootDir, ws);
      const run = (cmd: string) => runCommand(cmd, dir, { ...app.sandbox, network: false }, { timeoutMs: 20_000, signal: AbortSignal.timeout(25_000), maxBytes: 300_000 });
      // No owner OK for these, so the repository's own settings may not make git run programs.
      const g = `git ${GIT_SAFE.map(shq).join(' ')}`;
      const repo = await run(`${g} rev-parse --show-toplevel`);
      if (repo.exitCode !== 0) return send(res, 200, { repo: false });
      const [status, diff, log] = await Promise.all([run(`${g} status --short --branch`), run(`${g} --no-pager diff --no-ext-diff --no-textconv --stat --patch HEAD 2>/dev/null || ${g} --no-pager diff --no-ext-diff --no-textconv --stat --patch`), run(`${g} --no-pager log --oneline --decorate -n 10`)]);
      return send(res, 200, { repo: true, status: app.redactor.redact(status.output).slice(0, 20_000), diff: app.redactor.redact(diff.output).slice(0, 200_000), log: app.redactor.redact(log.output).slice(0, 5000) });
    }

    // Read a text file from a workspace (project page viewer). Read-only, size-limited.
    if (a === 'workspaces' && b && c === 'file' && method === 'GET') {
      const ws = validWorkspace(b);
      const rel = new URL(req.url ?? '/', 'http://x').searchParams.get('path') ?? '';
      let full: string;
      try {
        full = resolveInside(workspaceDir(rootDir, ws), rel);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st?.isFile()) throw new HttpError(404, 'File not found');
      // Only the start of a big file is read (a 4 GB log never has to fit in memory).
      const buf = Buffer.alloc(Math.min(st.size, 200_000));
      const fd = openSync(full, 'r');
      try {
        readSync(fd, buf, 0, buf.length, 0);
      } finally {
        closeSync(fd);
      }
      const binary = buf.subarray(0, 8000).includes(0);
      return send(res, 200, { path: rel, size: st.size, binary, text: binary ? '' : buf.toString('utf8'), truncated: st.size > 200_000 });
    }
    if (a === 'workspaces' && !b && method === 'GET') {
      const dir = join(rootDir, 'workspaces');
      const names = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
      if (!names.includes('main')) names.unshift('main');
      return send(res, 200, names.sort());
    }

    if (a === 'approvals' && b && method === 'POST') {
      const body = await readJson(req);
      if (!app.approvals.decide(b, body.approved === true)) throw new HttpError(404, 'That request is no longer waiting.');
      return send(res, 200, { ok: true });
    }

    if (a === 'live' && !b && method === 'GET') {
      // Live voice calls: available when the voice service chosen in Settings → Voice is usable
      // (Grok realtime voice or OpenAI Realtime); says which one and who pays for it.
      if (opts.demo) {
        // Demo: calls only with the reviewer code (calls are off when none is set).
        const d = demoCalls.view(visitorKey(req));
        const v = liveView();
        if (!d.enabled) return send(res, 200, { available: false, engine: null, how: null, message: 'Live calls are off in the demo.', demo: d, inCall: false });
        return send(res, 200, { available: v.available, engine: v.engine, how: v.how, ...(v.available ? { billedTo: 'the demo server' } : { message: 'Live calls are not available on the demo right now.' }), demo: d, inCall: false });
      }
      return send(res, 200, { ...liveView(), inCall: Boolean(liveCall && !liveCall.ended) });
    }
    // Phase 13: background jobs (list, stop) and the GitHub token used for pushing.
    if (a === 'jobs') {
      const jobs = app.jobs;
      if (!jobs) throw new HttpError(404, 'Not available');
      if (!b && method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://x');
        // Phase 52: each job's model usage (agent jobs) and whether it can continue with more budget.
        return send(res, 200, jobs.list({ conversationId: url.searchParams.get('conversation') ?? undefined, limit: 20 }).map((j) => {
          const u = app.usage?.forJob(j.id);
          return { ...j, ...(u?.calls ? { usage: { ...u, line: usageLine(u) } } : {}), ...(j.status === 'budget' ? { canContinue: jobs.canContinue(j.id) } : {}) };
        }));
      }
      if (b && c === 'stop' && method === 'POST') return send(res, 200, { stopped: jobs.stop(Number(b)) });
      if (b && c === 'continue' && method === 'POST') {
        const body = await readJson(req);
        try {
          const { job } = jobs.continueWithMore(Number(b), cleanBudget(body));
          return send(res, 200, job);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
    }
    // Phase 52: the cost and token meter (Settings → Data & health → Usage) and the price table.
    if (a === 'usage') {
      const meter = app.usage;
      if (!meter) throw new HttpError(404, 'Not available');
      if (!b && method === 'GET') {
        const now = app.now().getTime();
        const tz = app.settings.get().timeZone;
        // "Today" starts at local midnight.
        const startOfToday = dayStartUtc(localDate(app.now().toISOString(), tz), tz);
        // M11: every companion's model calls, with a split by companion (prices and budgets are shared).
        const meters = (opts.companions?.all() ?? []).filter((x) => x.app.usage).map((x) => ({ id: x.id, name: x.app.persona.name, meter: x.app.usage! }));
        if (!meters.length) meters.push({ id: app.companionId ?? 'main', name: app.persona.name, meter });
        const range = (since: Date) => {
          const s = mergeSummaries(meters.map((x) => ({ id: x.id, name: x.name, summary: x.meter.summary(since.toISOString()) })));
          return { ...s, line: usageLine(s.total), byModel: s.byModel.map((m) => ({ ...m, line: usageLine(m) })), byPurpose: s.byPurpose.map((m) => ({ ...m, line: usageLine(m) })), byCompanion: meters.length > 1 ? s.byCompanion.map((m) => ({ ...m, line: usageLine(m) })) : [] };
        };
        const st = app.settings.get();
        return send(res, 200, {
          today: range(startOfToday),
          week: range(new Date(now - 7 * 86_400_000)),
          month: range(new Date(now - 30 * 86_400_000)),
          prices: st.prices ?? [],
          defaults: DEFAULT_PRICES,
          jobBudget: cleanBudget(st.jobBudget),
          teamLimits: cleanLimits(st.teamLimits),
          providers: st.providers.map((pr) => ({ id: pr.id, label: pr.label })),
        });
      }
      if (b === 'settings' && method === 'PUT') {
        const body = await readJson(req);
        const patch: Partial<Settings> = {};
        try {
          if (body.prices !== undefined) patch.prices = cleanPrices(body.prices);
          if (body.jobBudget !== undefined) patch.jobBudget = cleanBudget(body.jobBudget);
          if (body.teamUsd !== undefined || body.teamTokens !== undefined) patch.teamLimits = cleanLimits({ ...app.settings.get().teamLimits, ...(body.teamTokens !== undefined ? { tokens: body.teamTokens } : {}), ...(body.teamUsd !== undefined ? { usd: body.teamUsd } : {}) });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        app.settings.update(patch);
        return send(res, 200, { ok: true, prices: priceTable(app.settings.get().prices).length });
      }
    }
    // Phase 52: new projects from tested starters (the project page's "New project from a starter").
    if (a === 'starters') {
      if (!b && method === 'GET') return send(res, 200, { starters: listStarters() });
      if (!b && method === 'POST') {
        const body = await readJson(req);
        let convId = typeof body.conversationId === 'string' ? body.conversationId : '';
        const ws = body.workspace ? validWorkspace(body.workspace) : 'main';
        const project = body.projectId !== undefined && body.projectId !== null ? projectOrThrow(body.projectId) : null;
        if (!convId) convId = app.store.createConversation({ title: `New project: ${String(body.projectName ?? '').slice(0, 60)}`, mode: 'coding', workspace: ws, projectId: project?.id ?? null }).id;
        else if (!app.store.getConversation(convId)) throw new HttpError(404, 'Conversation not found');
        try {
          const r = createFromStarter(app, { conversationId: convId, workspace: ws, name: String(body.name ?? ''), project: String(body.projectName ?? '').trim() });
          const msg = app.store.addMessage(convId, 'notice', `job:${r.message}`);
          app.events?.publish({ type: 'message', conversationId: convId, message: msg, reason: 'job' });
          return send(res, 201, { conversationId: convId, jobId: r.jobId, starter: r.starter.name, message: r.message });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
    }
    // Phase 40: watched GitHub repositories (issues become tasks) and what she knows about projects.
    if (a === 'github-watch') {
      if (method === 'GET') {
        const w = watchSettings(app);
        let issues: OpenIssue[] = [];
        let error: string | undefined;
        if (w.repos.length && app.vault.get('git:github')) {
          try {
            issues = await openIssues(app);
          } catch (err) {
            error = (err as Error).message;
          }
        }
        return send(res, 200, { ...w, seen: undefined, connected: Boolean(app.vault.get('git:github')), issues, ...(error ? { error } : {}) });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        try {
          app.settings.update({ githubWatch: cleanWatch(body, watchSettings(app)) });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && b === 'check') return send(res, 200, { found: (await checkIssues(app)).length });
    }
    if (a === 'code-projects' && app.projects) {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!b && method === 'GET') {
        const ws = url.searchParams.get('workspace') ?? 'main';
        try {
          return send(res, 200, { workspace: ws, projects: app.projects.get(ws, { fresh: url.searchParams.get('fresh') === '1' }) });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (b === 'notes' && !c && method === 'POST') {
        const body = await readJson(req);
        const kind = ['decision', 'convention', 'command', 'note'].includes(String(body.kind)) ? (String(body.kind) as 'note') : 'note';
        try {
          return send(res, 200, app.projects.addNote(String(body.workspace ?? 'main'), String(body.path ?? '.'), kind, String(body.text ?? '')));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (b === 'notes' && c && method === 'DELETE') return send(res, 200, { deleted: app.projects.deleteNote(Number(c)) });
    }
    // Phase 50: the code map of a workspace (the Map tab on the project page). Owner only, read only.
    if (a === 'codemap' && b) {
      const maps = app.codemap;
      if (!maps) throw new HttpError(404, 'The code map is not available');
      const ws = validWorkspace(b);
      const dir = workspaceDir(rootDir, ws);
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      if (!c && method === 'GET') {
        const r = await maps.until(dir, 3000);
        const st = r.store.status();
        const counts = r.store.importCounts();
        return send(res, 200, { workspace: ws, done: r.done, status: st, files: r.store.files().map((f) => ({ path: f.path, lang: f.lang, size: f.size, lines: f.lines, symbols: f.symbols, importedBy: counts.get(f.path) ?? 0 })) });
      }
      if (c === 'refresh' && method === 'POST') {
        const r = await maps.until(dir, 5000);
        return send(res, 200, { done: r.done, status: r.store.status(), reindexed: r.report?.reindexed.length ?? 0, removed: r.report?.removed.length ?? 0 });
      }
      if (c === 'file' && method === 'GET') {
        const store = maps.get(dir);
        const found = store.findPath(q.get('path') ?? '');
        if (!found.path) throw new HttpError(404, 'That file is not in the map.');
        const f = store.files().find((x) => x.path === found.path);
        const d = store.deps(found.path);
        return send(res, 200, { path: found.path, lang: f?.lang, size: f?.size, lines: f?.lines, symbols: store.symbolsIn(found.path), imports: d.imports, importedBy: d.importedBy });
      }
      if (c === 'find' && method === 'GET') {
        const store = (await maps.until(dir, 1500)).store;
        const query = (q.get('q') ?? '').trim().slice(0, 300);
        if (!query) return send(res, 200, { hits: [] });
        const kind = q.get('kind') ?? '';
        const ident = /^[\w$.:#]+$/.test(query);
        if (kind === 'symbol' || (!kind && ident)) {
          const r = store.findSymbols(query, 30);
          if (r.hits.length || kind === 'symbol') return send(res, 200, { kind: 'symbol', total: r.total, hits: r.hits.map((s) => ({ path: s.path, line: s.line, name: s.parent ? `${s.parent}.${s.name}` : s.name, kind: s.kind, snippet: s.signature })) });
        }
        const meaning = kind === 'meaning' || (!kind && !ident);
        const hits = meaning && maps.target ? await store.findMeaning(maps.target, query, 30) : store.findWords(query, 30);
        return send(res, 200, { kind: meaning && maps.target ? 'meaning' : 'text', ...(meaning && !maps.target ? { note: "Meaning search isn't set up (Settings → Which model does what → Meaning search), so this is a word search." } : {}), hits: hits.map((h) => ({ path: h.path, line: h.line, name: h.symbol, snippet: h.snippet, by: h.by })) });
      }
    }
    // Phase 50: her recipes (Settings → Abilities → Recipes).
    if (a === 'recipes') {
      const rs = app.recipes;
      if (!rs) throw new HttpError(404, 'Recipes are not available');
      if (!b && method === 'GET') return send(res, 200, { recipes: rs.list() });
      const id = Number(b);
      if (b && Number.isInteger(id) && !c) {
        if (method === 'GET') {
          const r = rs.get(id);
          if (!r) throw new HttpError(404, 'Recipe not found');
          return send(res, 200, r);
        }
        if (method === 'PATCH') {
          const body = await readJson(req);
          let r;
          try {
            r = rs.update(id, {
              ...(body.title !== undefined ? { title: String(body.title) } : {}),
              ...(body.whenToUse !== undefined ? { whenToUse: String(body.whenToUse) } : {}),
              ...(body.steps !== undefined ? { steps: String(body.steps) } : {}),
              ...(body.workspace !== undefined ? { workspace: body.workspace ? String(body.workspace) : null } : {}),
              ...(body.tags !== undefined ? { tags: Array.isArray(body.tags) ? (body.tags as string[]) : String(body.tags).split(',') } : {}),
            });
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
          if (!r) throw new HttpError(404, 'Recipe not found');
          app.events?.publish({ type: 'recipes' });
          return send(res, 200, r);
        }
        if (method === 'DELETE') {
          if (!rs.delete(id)) throw new HttpError(404, 'Recipe not found');
          app.events?.publish({ type: 'recipes' });
          return send(res, 200, { ok: true });
        }
      }
    }
    // Phase 39: the team she leads.
    if (a === 'team') {
      const team = app.team;
      if (!team) throw new HttpError(404, 'Not available');
      const brief = (t: TeamTask) => ({ ...t, usage: team.usage(t.id), steps: t.steps.map((s) => ({ ...s, receipts: s.receipts.map((r) => ({ name: r.name, status: r.status, summary: app.tools.get(r.name)?.summarize(r.args) ?? r.name, output: r.output.slice(0, 600) })) })) });
      if (!b && method === 'GET') {
        const s = app.settings.get();
        return send(res, 200, {
          tasks: team.list(20).map(brief),
          helpers: teamHelpers(app).map((h) => ({ ...h, modelLabel: h.model ? h.model.model : (() => { try { return resolveChain(app, { id: '', providerId: null, model: null, mode: 'coding', private: false, partner: null, channel: 'web', workspace: 'main' } as unknown as Conversation, h.job)[0].model; } catch { return null; } })() })),
          roles: Object.entries(ROLES).map(([id, r]) => ({ id, emoji: r.emoji, blurb: r.blurb, tools: r.tools, job: r.job })),
          custom: s.helpers ?? [],
          limits: cleanLimits(s.teamLimits),
          tools: app.tools.list().map((t) => t.spec.name),
        });
      }
      if (!b && method === 'POST') {
        const body = await readJson(req);
        let convId = typeof body.conversationId === 'string' ? body.conversationId : '';
        if (!convId) convId = app.store.createConversation({ title: `Team: ${String(body.goal ?? '').replace(/\s+/g, ' ').slice(0, 50)}`, mode: 'coding' }).id;
        try {
          return send(res, 200, brief(team.start(convId, String(body.goal ?? ''), { limits: body.limits as Partial<TeamLimits> })));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (b === 'settings' && method === 'PUT') {
        const body = await readJson(req);
        const patch: Partial<Settings> = {};
        try {
          if (body.helpers !== undefined) patch.helpers = cleanHelpers(body.helpers, app.tools.list().map((t) => t.spec.name));
          if (body.limits !== undefined) patch.teamLimits = cleanLimits(body.limits);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        app.settings.update(patch);
        return send(res, 200, { ok: true });
      }
      // Phase 40: a workflow from a GitHub issue; answering a checkpoint.
      if (b === 'from-issue' && method === 'POST') {
        const body = await readJson(req);
        try {
          return send(res, 200, brief(await startFromIssue(app, String(body.repo ?? ''), Number(body.number), { checkpoints: body.checkpoints !== false, pr: body.pr !== false })));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      const id = Number(b);
      if (id && !c && method === 'GET') {
        const t = team.get(id);
        if (!t) throw new HttpError(404, 'No such task');
        return send(res, 200, { task: brief(t), log: team.log(id), approvals: team.approvals(id) });
      }
      if (id && c === 'stop' && method === 'POST') return send(res, 200, { stopped: team.stop(id) });
      if (id && c === 'continue' && method === 'POST') {
        const body = await readJson(req);
        try {
          return send(res, 200, brief(team.continueWithMore(id, body)));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (id && c === 'checkpoint' && method === 'POST') {
        const body = await readJson(req);
        const d = String(body.decision ?? '');
        if (d !== 'go' && d !== 'skip' && d !== 'stop') throw new HttpError(400, 'go, skip or stop');
        if (!team.answer(id, d)) throw new HttpError(400, "That task isn't waiting at a checkpoint.");
        return send(res, 200, { ok: true });
      }
      if (id && c === 'steps' && parts[3] && method === 'POST') {
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        if (parts[4] === 'stop') return send(res, 200, { stopped: team.stopStep(id, Number(parts[3])) });
        if (parts[4] === 'message') {
          if (!team.message(id, Number(parts[3]), String(body.text ?? ''))) throw new HttpError(400, "That helper isn't working right now.");
          return send(res, 200, { ok: true });
        }
      }
    }
    // Phase 14: Google (Gmail + Calendar) on the owner's own Google app.
    if (a === 'google') {
      const g = app.google;
      if (!g) throw new HttpError(404, 'Not available');
      const origin = typeof req.headers.origin === 'string' && req.headers.origin !== 'null' ? req.headers.origin : `${opts.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
      const redirect = `${origin}/api/google/callback`;
      if (!b && method === 'GET') return send(res, 200, { ...g.status(), redirect });
      if (!b && method === 'DELETE') {
        clearTodayCache();
        await g.disconnect();
        return send(res, 200, g.status());
      }
      if (b === 'client' && method === 'PUT') {
        const body = await readJson(req);
        try {
          g.setClient(String(body.clientId ?? ''), String(body.clientSecret ?? ''));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        return send(res, 200, { ...g.status(), redirect });
      }
      if (b === 'client' && method === 'DELETE') {
        await g.disconnect();
        g.forgetClient();
        return send(res, 200, g.status());
      }
      if (b === 'connect' && method === 'POST') {
        try {
          return send(res, 200, { url: g.authUrl(redirect) });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
    }
    // Phase 16: Adult mode. Off by default; on only from a web browser with the 18+ confirmation.
    if (a === 'pair' && !b && method === 'POST') {
      // A new code replaces any earlier one.
      const code = newPairCode();
      pairing = { hash: createHash('sha256').update(normalizePairCode(code)).digest(), expires: Date.now() + PAIR_MS };
      const origin = typeof req.headers.origin === 'string' && req.headers.origin !== 'null' ? req.headers.origin : `http://${req.headers.host}`;
      const url = `${origin}/pair#${code}`;
      return send(res, 200, { code, url, expiresAt: new Date(pairing.expires).toISOString(), qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg(url)).toString('base64')}` });
    }
    if (a === 'pair' && !b && method === 'DELETE') {
      pairing = undefined;
      return send(res, 200, { ok: true });
    }
    // "Report this reply" (Phase 19).
    if (a === 'reports' && app.reports) {
      if (!b && method === 'GET') {
        // Demo visitors only see their own reports.
        const reports = opts.demo ? app.reports.list().filter((r) => r.conversationId !== null && demoOwner.get(r.conversationId) === visitorKey(req)) : app.reports.list();
        return send(res, 200, { reports, inbox: opts.reportInbox && !opts.demo ? app.reports.inbox() : null, reasons: REASON_LABELS });
      }
      if (!b && method === 'POST') {
        const body = await readJson(req);
        if (!validReason(body.reason)) throw new HttpError(400, 'Choose a reason.');
        const convId = String(body.conversationId ?? '');
        const cx = ctxOf(convId);
        if (opts.demo && demoOwner.get(convId) !== visitorKey(req)) throw new HttpError(404, 'Conversation not found');
        const msg = cx.store.messages(convId).find((m) => m.id === Number(body.messageId));
        if (!msg || msg.role !== 'assistant') throw new HttpError(404, 'That reply is gone.');
        const report = app.reports.add({ messageId: msg.id, conversationId: convId, text: app.redactor.redact(msg.content), reason: body.reason, note: typeof body.note === 'string' ? body.note : '', ...(typeof msg.meta?.model === 'string' ? { model: msg.meta.model } : {}) });
        if (cx === app) cx.store.updateMessageMeta(msg.id, { reported: body.reason });
        const to = opts.reportTo ?? DEFAULT_REPORT_INBOX;
        let sent = false;
        if (body.toDeveloper !== false && to !== 'off') sent = await app.reports.send(report.id, { platform: fromPhoneApp(req) ? (/iPhone|iPad/.test(String(req.headers['user-agent'])) ? 'ios' : 'android') : 'web', appVersion: opts.info?.version ?? 'dev' }, to);
        return send(res, 201, { ok: true, sent });
      }
    }
    if (a === 'adult' && !b) {
      const cur = app.settings.get().adultMode ?? { on: false };
      const view = () => {
        const m = app.settings.get().adultMode ?? { on: false };
        return { on: adultModeOn(app.settings.get()), confirmedAt: m.confirmedAt ?? null, canTurnOn: !fromSaraApp(req) && !opts.demo, reason: opts.demo ? 'demo' : fromPhoneApp(req) ? 'app' : null };
      };
      if (method === 'GET') return send(res, 200, await view());
      if (method === 'PUT') {
        const body = await readJson(req);
        if (body.on === true) {
          if (opts.demo) throw new HttpError(403, 'Adult mode is not available in the demo.');
          if (fromSaraApp(req)) throw new HttpError(403, 'Adult mode can only be turned on in a web browser.');
          if (body.confirm18 !== true) throw new HttpError(400, 'Confirm that you are 18 or older to turn on adult mode.');
          app.settings.update({ adultMode: { on: true, confirmedAt: app.now().toISOString(), confirmedFrom: deviceLabel(String(req.headers['user-agent'] ?? '')) } });
        } else {
          app.settings.update({ adultMode: { on: false, ...(cur.confirmedAt ? { confirmedAt: cur.confirmedAt } : {}) } });
        }
        return send(res, 200, await view());
      }
    }
    // Phase 29: Home Assistant (address in settings, token in the vault).
    if (a === 'home' && !b) {
      if (method === 'GET') {
        const base = app.settings.get().home?.url;
        const token = app.vault.get(HOME_VAULT);
        if (!base || !token) return send(res, 200, { url: base ?? '', hasToken: Boolean(token), ok: false });
        const r = await fetch(`${base}/api/config`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000), redirect: 'error' }).catch((err: Error) => err);
        if (r instanceof Error) return send(res, 200, { url: base, hasToken: true, ok: false, error: `Couldn't reach it from this server (${r.message}).` });
        if (r.status === 401) return send(res, 200, { url: base, hasToken: true, ok: false, error: 'Home Assistant refused the token.' });
        const cfg = r.ok ? ((await r.json().catch(() => ({}))) as { location_name?: string; version?: string }) : {};
        return send(res, 200, { url: base, hasToken: true, ok: r.ok, name: cfg.location_name ?? null, version: cfg.version ?? null, ...(r.ok ? {} : { error: `Home Assistant said ${r.status}.` }) });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        if (body.url === '' || body.remove === true) {
          app.settings.update({ home: undefined });
          app.vault.delete(HOME_VAULT);
          return send(res, 200, { url: '', hasToken: false });
        }
        let url: string;
        try {
          url = cleanHomeUrl(String(body.url ?? ''));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        const token = String(body.token ?? '').trim();
        if (token && !/^[\w.-]{20,1000}$/.test(token)) throw new HttpError(400, 'That does not look like a Home Assistant access token.');
        if (!token && !app.vault.get(HOME_VAULT)) throw new HttpError(400, 'Paste a long-lived access token too.');
        app.settings.update({ home: { url } });
        if (token) app.vault.set(HOME_VAULT, token);
        return send(res, 200, { url, hasToken: true });
      }
    }
    if (a === 'github' && !b) {
      if (method === 'GET') {
        const token = app.vault.get(GITHUB_VAULT);
        if (!token) return send(res, 200, { hasToken: false });
        const r = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token}`, 'user-agent': 'Sara' }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
        const login = r?.ok ? ((await r.json()) as { login?: string }).login : undefined;
        return send(res, 200, { hasToken: true, login: login ?? null, ok: Boolean(login) });
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        const token = String(body.token ?? '').trim();
        if (!token) app.vault.delete(GITHUB_VAULT);
        else if (!/^(gh[pousr]_|github_pat_)[\w]{20,}$/.test(token)) throw new HttpError(400, 'That does not look like a GitHub token (it starts with github_pat_ or ghp_).');
        else app.vault.set(GITHUB_VAULT, token);
        return send(res, 200, { hasToken: Boolean(token) });
      }
    }
    /**
     * Security review: changing how you sign in needs proof it's really you, not only a session
     * cookie (which could have been taken from an unlocked device): the owner token, or the
     * current code when two-step sign-in is on.
     */
    const confirmIdentity = (body: Record<string, unknown>, opt: { passkey?: boolean } = {}) => {
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      let ok = false;
      // A passkey assertion made just now for this purpose (where the route allows one).
      const pk = body.passkey as Record<string, unknown> | undefined;
      if (opt.passkey && pk && typeof pk === 'object') {
        const id = String(pk.id ?? '');
        const key = auth.passkey(id);
        try {
          if (!key) throw new Error('unknown passkey');
          const count = verifyAssertion(
            { id, clientDataJSON: String(pk.clientDataJSON ?? ''), authenticatorData: String(pk.authenticatorData ?? ''), signature: String(pk.signature ?? '') },
            key,
            { challenge: takeChallenge(clientChallenge(pk.clientDataJSON), 'confirm'), ...passkeySite(req) },
          );
          auth.usedPasskey(id, count);
          ok = true;
        } catch {
          ok = false;
        }
      } else ok = auth.twoStepOn ? auth.checkTwoStep(String(body.code ?? '')) : auth.verifyToken(String(body.token ?? ''));
      if (!ok) {
        limiter.fail(ip);
        throw new HttpError(403, auth.twoStepOn ? 'Enter the current code from your authenticator app to confirm.' : 'Enter your owner token to confirm.', { confirm: auth.twoStepOn ? 'code' : 'token' });
      }
    };
    // Phase 24: passkeys and two-step sign-in (Settings → Devices and sign-in).
    if (a === 'security' && !b && method === 'GET') return send(res, 200, { passkeys: auth.passkeys(), twoStep: auth.twoStepOn });
    // Security review: a passkey can confirm it's you (approving an app's device code).
    if (a === 'passkey' && b === 'confirm-options' && method === 'POST') {
      if (opts.demo) throw new HttpError(403, 'Not in the demo.');
      const site = passkeySite(req);
      await readJson(req);
      if (!auth.passkeys().length) throw new HttpError(404, 'No passkeys yet.');
      return send(res, 200, { challenge: issueChallenge('confirm'), rpId: site.rpId, userVerification: 'required', timeout: 120_000 });
    }
    if (a === 'passkey' && b === 'register-options' && method === 'POST') {
      if (opts.demo) throw new HttpError(403, 'Not in the demo.');
      const site = passkeySite(req);
      confirmIdentity(await readJson(req));
      const owner = app.settings.get().ownerName?.trim() || 'Owner';
      return send(res, 200, {
        challenge: issueChallenge('register'),
        rp: { id: site.rpId, name: `${app.persona.name} (Sara)` },
        // One owner per server: a fixed user handle, so a new passkey replaces an old one on the same device.
        user: { id: Buffer.from(`sara-owner:${site.rpId}`).toString('base64url'), name: owner, displayName: owner },
        pubKeyCredParams: [-7, -8, -257].map((alg) => ({ type: 'public-key', alg })),
        excludeCredentials: auth.passkeys().map((p) => ({ type: 'public-key', id: p.id })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        timeout: 120_000,
      });
    }
    if (a === 'passkey' && b === 'register' && method === 'POST') {
      const site = passkeySite(req);
      const body = await readJson(req);
      try {
        const k = verifyRegistration({ clientDataJSON: String(body.clientDataJSON ?? ''), attestationObject: String(body.attestationObject ?? '') }, { challenge: takeChallenge(clientChallenge(body.clientDataJSON), 'register'), ...site });
        auth.addPasskey({ ...k, label: String(body.label ?? '').trim() || deviceLabel(req.headers['user-agent']) });
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      return send(res, 200, { passkeys: auth.passkeys(), twoStep: auth.twoStepOn });
    }
    if (a === 'passkey' && b === 'remove' && !c && method === 'POST') {
      const body = await readJson(req);
      confirmIdentity(body);
      if (!auth.removePasskey(String(body.id ?? ''))) throw new HttpError(404, 'No such passkey');
      return send(res, 200, { passkeys: auth.passkeys(), twoStep: auth.twoStepOn });
    }
    if (a === 'two-step') {
      if (opts.demo) throw new HttpError(403, 'Not in the demo.');
      const body = method === 'POST' ? await readJson(req) : {};
      if (b === 'start' && method === 'POST') {
        confirmIdentity(body);
        try {
          const t = auth.startTwoStep(app.settings.get().ownerName?.trim() || 'owner');
          return send(res, 200, { secret: t.secret, url: t.url, qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg(t.url)).toString('base64')}` });
        } catch (err) {
          throw new HttpError(409, (err as Error).message);
        }
      }
      if (b === 'confirm' && method === 'POST') {
        if (auth.twoStepOn) throw new HttpError(409, 'Two-step sign-in is already on.');
        if (!auth.checkTwoStep(String(body.code ?? ''))) throw new HttpError(400, "That code doesn't match. Check the time on your phone and use the newest code.");
        // Devices that signed in with the token alone are signed out; this one stays.
        const me = auth.sessionId(cookies(req)[SESSION_COOKIE]);
        const signedOut = auth.signOut('others', me);
        prunePush();
        return send(res, 200, { twoStep: true, signedOut });
      }
      if (b === 'stop' && method === 'POST') {
        try {
          auth.stopTwoStep(String(body.code ?? ''));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        return send(res, 200, { twoStep: false });
      }
    }
    // Phase 33: the desktop apps, when the owner has put them in <data>/downloads (see docs/desktop.md).
    if (a === 'desktop-apps' && method === 'GET') {
      const dir = join(app.rootDir ?? app.dataDir, 'downloads');
      const files = { windows: 'Sara.exe', mac: 'Sara.dmg' } as const;
      if (!b) {
        const out: Record<string, { size: number; updated: string } | null> = {};
        for (const [k, f] of Object.entries(files)) {
          const st = statSync(join(dir, f), { throwIfNoEntry: false });
          out[k] = st?.isFile() ? { size: st.size, updated: st.mtime.toISOString() } : null;
        }
        return send(res, 200, out);
      }
      const name = files[b as keyof typeof files];
      const st = name ? statSync(join(dir, name), { throwIfNoEntry: false }) : undefined;
      if (!name || !st?.isFile()) throw new HttpError(404, 'Not found');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', ...SECURITY_HEADERS });
      return void createReadStream(join(dir, name)).pipe(res);
    }
    // Phase 52: device-code requests waiting for the owner (Settings → Devices, or /device with the typed code).
    if (a === 'device') {
      if (b === 'logout' && method === 'POST') {
        const id = deviceTokenOf(req);
        if (!id) throw new HttpError(400, 'Only an app signed in with a device code can sign itself out here.');
        auth.signOut(id);
        prunePush();
        return send(res, 200, { ok: true });
      }
      if (b === 'whoami' && method === 'GET') {
        const id = deviceTokenOf(req);
        const d = id ? auth.devices().find((x) => x.id === id) : undefined;
        return send(res, 200, { companion: app.persona.name, device: d ? { id: d.id, label: d.label, scope: d.kind === 'home-assistant' ? 'home-assistant' : 'full' } : null, disclosureAccepted: Boolean(app.settings.get().disclosureAcceptedAt), disclosure: disclosureText(app.persona.name, appLanguage(app.settings.get())) });
      }
      // Approving needs the owner in a browser (or the owner token): an app can't let in another app.
      if (deviceTokenOf(req)) throw new HttpError(403, 'Approve new apps in the web app (Settings → Devices and sign-in).');
      if (b === 'pending' && method === 'GET') {
        const code = new URL(req.url ?? '/', 'http://x').searchParams.get('code');
        if (code) {
          const p = deviceFlow.find(code);
          if (!p) throw new HttpError(404, 'That code is wrong, was already used, or has expired. Start the sign-in again in the app.');
          return send(res, 200, { request: p });
        }
        return send(res, 200, { pending: deviceFlow.pending() });
      }
      if ((b === 'approve' || b === 'deny') && method === 'POST') {
        const body = await readJson(req);
        const code = String(body.code ?? '');
        if (b === 'deny') {
          if (!deviceFlow.deny(code)) throw new HttpError(404, 'That request is no longer waiting.');
          app.events?.publish({ type: 'device', pending: deviceFlow.pending().length });
          return send(res, 200, { ok: true });
        }
        // Security review: a session cookie alone isn't enough to let in an app that keeps a token
        // for weeks: confirm with the owner token, the current two-step code, or a passkey.
        if (!deviceFlow.find(code)) throw new HttpError(404, 'That code is wrong, was already used, or has expired. Start the sign-in again in the app.');
        confirmIdentity(body, { passkey: true });
        const r = deviceFlow.approve(code, (name, scope) => auth.createDeviceToken(name, scope === 'home-assistant' ? 'home-assistant' : undefined));
        if (!r) throw new HttpError(404, 'That request is no longer waiting (it may have expired).');
        app.events?.publish({ type: 'device', pending: deviceFlow.pending().length });
        return send(res, 200, { ok: true, name: r.name });
      }
    }
    // Phase 57: Settings → Connections → Other apps: the switches, the allowed browser addresses and the keys.
    // The stdio bridge for MCP apps that start a program (Claude Desktop): one standalone file.
    if (a === 'other-apps' && b === 'bridge' && method === 'GET') {
      const f = join(webRoot, '..', 'src', 'mcp-bridge.ts');
      if (!existsSync(f)) throw new HttpError(404, 'The bridge file is not in this install.');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="sara-mcp.ts"', 'cache-control': 'no-store', ...SECURITY_HEADERS });
      return void createReadStream(f).pipe(res);
    }
    if (a === 'other-apps' && !b) {
      if (opts.demo) throw new HttpError(403, 'Not in the demo.');
      const view = () => ({ ...otherAppsSettings(app.settings.get()), keys: auth.devices().filter((d) => d.kind === 'api').map(({ id, label, createdAt, lastSeen }) => ({ id, label, createdAt, lastSeen })) });
      if (method === 'GET') return send(res, 200, view());
      if (method === 'PUT') {
        const body = await readJson(req);
        const cur = app.settings.get().otherApps ?? {};
        let origins = cur.origins ?? [];
        if (body.origins !== undefined) {
          try {
            origins = cleanOrigins(body.origins);
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
        }
        app.settings.update({ otherApps: { tools: typeof body.tools === 'boolean' ? body.tools : cur.tools === true, changes: typeof body.changes === 'boolean' ? body.changes : cur.changes === true, origins } });
        return send(res, 200, view());
      }
    }
    // Phase 57: an API key for another app (shown once). Like letting in an app: prove it's you.
    if (a === 'devices' && b === 'api-key' && !c && method === 'POST') {
      const body = await readJson(req);
      confirmIdentity(body, { passkey: true });
      const label = String(body.label ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || DEFAULT_APP_NAME;
      try {
        const k = auth.createApiKey(label);
        return send(res, 200, { key: k.token, id: k.id, label });
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }
    if (a === 'devices') {
      const current = auth.sessionId(cookies(req)[SESSION_COOKIE]);
      if (!b && method === 'GET') return send(res, 200, { devices: auth.devices().map((d) => ({ ...d, current: d.id === current })) });
      if (b === 'others' && method === 'DELETE') {
        const n = auth.signOut('others', current);
        prunePush();
        return send(res, 200, { signedOut: n });
      }
      if (b && method === 'DELETE') {
        const n = auth.signOut(b);
        prunePush();
        if (b === current) res.setHeader('set-cookie', cookie('', 0));
        return send(res, 200, { signedOut: n });
      }
    }
    if (a === 'owner-token' && b === 'rotate' && method === 'POST') {
      // A new owner token: every device is signed out; this one gets a fresh session.
      const body = await readJson(req);
      const ip = clientIp(req, opts.trustProxy);
      if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again later.');
      let token: string;
      try {
        token = auth.rotateToken(String(body.current ?? ''), { clearPasskeys: body.keepPasskeys !== true });
      } catch (err) {
        limiter.fail(ip);
        throw new HttpError(400, (err as Error).message);
      }
      const session = auth.createSession(deviceLabel(req.headers['user-agent']));
      prunePush();
      res.setHeader('set-cookie', cookie(session.value, session.maxAgeSeconds));
      return send(res, 200, { token });
    }
    if (a === 'setup') {
      // First-run guide: is setup needed, and what can be found on this machine without typing.
      if (!b && method === 'GET') {
        const s = app.settings.get();
        const done = Boolean(s.setupDone) || (s.providers.length > 0 && Boolean(s.ownerName));
        const ollama: { url: string; models: number }[] = [];
        if (!done || /[?&]detect\b/.test(req.url ?? '')) {
          const hosts = ['127.0.0.1', 'host.docker.internal'];
          await Promise.all(
            hosts.map(async (h) => {
              try {
                const r = await fetch(`http://${h}:11434/api/tags`, { signal: AbortSignal.timeout(1500) });
                if (!r.ok) return;
                const j = (await r.json()) as { models?: { name: string }[] };
                ollama.push({ url: `http://${h}:11434/v1`, models: (j.models ?? []).filter((m) => !/embed/i.test(m.name)).length });
              } catch {
                /* not there */
              }
            }),
          );
        }
        const subs = app.subscriptions;
        return send(res, 200, {
          done,
          ownerName: s.ownerName ?? '',
          ollama: ollama.slice(0, 1),
          subscriptions: { grok: subs?.grokStatus().signedIn ?? false, claude: subs?.claudeStatus().signedIn ?? false, chatgpt: Boolean(subs?.chatgpt.status().signedIn) },
        });
      }
      if (b === 'done' && method === 'POST') {
        app.settings.update({ setupDone: true });
        return send(res, 200, { done: true });
      }
    }
    if (a === 'providers') {
      if (!b && method === 'GET') return send(res, 200, providerView());
      if (b && !c && method === 'PUT') {
        const body = await readJson(req);
        let config;
        try {
          config = validateProviderConfig({ ...body, id: b });
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
        const s = app.settings.get();
        const was = s.providers.find((p) => p.id === b);
        const providers = s.providers.filter((p) => p.id !== b).concat(config);
        app.settings.update({ providers, defaultProviderId: s.defaultProviderId ?? config.id });
        if (typeof body.apiKey === 'string') {
          if (body.apiKey) app.vault.set(vaultKeyFor(b), body.apiKey.trim());
          else app.vault.delete(vaultKeyFor(b));
        }
        // Phase 56: a new provider, a new key or a new address: check its model list now.
        // UX 15: wait for that first check (up to 5 s) so the card shows its result, not "not checked yet".
        if (app.modelCatalog && (!was || was.baseUrl !== config.baseUrl || was.kind !== config.kind || typeof body.apiKey === 'string')) {
          const check = app.modelCatalog.refresh(b).catch(() => undefined);
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([check, new Promise<void>((r) => (timer = setTimeout(r, 5000)))]);
          clearTimeout(timer);
        }
        return send(res, 200, providerView());
      }
      if (b && !c && method === 'DELETE') {
        const s = app.settings.get();
        app.settings.update({
          providers: s.providers.filter((p) => p.id !== b),
          ...(s.defaultProviderId === b ? { defaultProviderId: undefined, defaultModel: undefined } : {}),
        });
        app.vault.delete(vaultKeyFor(b));
        app.modelCatalog?.forget(b);
        return send(res, 200, providerView());
      }
      // Phase 56: the kept model list (checked again when a day old), Refresh, and its options.
      if (b && c === 'models' && app.modelCatalog && !opts.demo) {
        const catalog = app.modelCatalog;
        const config = app.settings.get().providers.find((p) => p.id === b);
        const d = parts[3];
        if (d === 'options' && method === 'PUT') {
          const body = await readJson(req);
          if (!config) throw new HttpError(404, 'Provider not found');
          const cur = app.settings.get().modelLists ?? {};
          const next = { ...cur[b] };
          for (const k of ['keepCurrent', 'ollamaCloud', 'removeRetired'] as const) if (typeof body[k] === 'boolean') next[k] = body[k];
          app.settings.update({ modelLists: { ...cur, [b]: next } });
          if (typeof body.ollamaCloud === 'boolean') await catalog.refresh(b).catch(() => undefined);
          return send(res, 200, catalog.view(b));
        }
        if (!config) throw new HttpError(404, 'Provider not found');
        if ((d === 'refresh' && method === 'POST') || (!d && method === 'GET')) {
          const view = d === 'refresh' ? await catalog.refresh(b) : await catalog.list(b);
          // Never checked successfully: the reason, as before.
          if (!view.checkedAt && view.error) throw new HttpError(502, view.error);
          return send(res, 200, view);
        }
      }
      if (b && c === 'models' && method === 'GET') {
        const config = app.settings.get().providers.find((p) => p.id === b);
        if (!config) throw new HttpError(404, 'Provider not found');
        const factory = app.providerFactory ?? createProvider;
        try {
          const all = await factory(config, app.vault.get(vaultKeyFor(b)), app.subscriptions).listModels(AbortSignal.timeout(15000));
          // Embedding models can't chat; leave them out of the pickers.
          const models = all.filter((m) => !/embed/i.test(m));
          return send(res, 200, { models, hidden: all.length - models.length });
        } catch (err) {
          throw new HttpError(502, (err as Error).message);
        }
      }
    }

    // Phase 23: "Getting started" on the Today page.
    if (a === 'checklist' && !b) {
      const view = () =>
        checklist(app, {
          devices: auth.devices().map((d) => d.label),
          pushDevices: (app.push?.list().length ?? 0) + (app.push?.apns?.devices().length ?? 0),
          personaCustom: existsSync(join(app.dataDir, 'persona.json')),
        });
      if (method === 'GET') return send(res, 200, await view());
      if (method === 'PUT') {
        const body = await readJson(req);
        app.settings.update({ checklistHidden: body.hidden === true });
        return send(res, 200, await view());
      }
    }
    // Phase 46: how the owner reaches her (set by the installer; read-only here).
    if (a === 'access' && !b && method === 'GET') {
      const acc = accessInfo();
      return send(res, 200, { ...acc, system: systemName(), ...(acc.url ? { qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg(acc.url)).toString('base64')}` } : {}) });
    }
    // Phase 23: updates from Settings (native installs; the root updater does the work).
    if (a === 'update' && !b) {
      const view = () => ({ available: updater.available && !opts.demo, how: updater.how, version: info.version, revision: info.revision, status: updater.status(app.now()) });
      if (method === 'GET') return send(res, 200, await view());
      if (method === 'POST') {
        if (opts.demo) throw new HttpError(403, 'Not in the demo.');
        const body = await readJson(req);
        // Phase 46: Windows and macOS check the release page; the installer does the update.
        if (updater.how === 'release') {
          const status = body.action === 'update' ? await updater.update(app.now()) : await updater.check(app.now());
          return send(res, 200, { ...view(), status });
        }
        try {
          updater.request(body.action === 'update' ? 'update' : 'check');
        } catch (err) {
          throw new HttpError(409, (err as Error).message);
        }
        return send(res, 202, await view());
      }
    }
    // Phase 22: weekly review.
    // Phase 53: your story together: the merged timeline, look backs she wrote, write a new one.
    if (a === 'story') {
      const dateOk = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`)) ? x : undefined);
      if (!b && method === 'GET') {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        const filter = STORY_FILTERS.includes(q.get('filter') as StoryFilter) ? (q.get('filter') as StoryFilter) : 'all';
        const first = app.store.firstOwnerMessageAt();
        return send(res, 200, {
          items: gatherStory(app, { filter, from: dateOk(q.get('from')), to: dateOk(q.get('to')) }),
          lookbacks: lookbacks(app),
          running: Boolean(app.story?.pending),
          error: app.story?.lastError ?? null,
          firstDay: first ? localDate(first.toISOString(), app.settings.get().timeZone) : null,
          today: localDate(app.now().toISOString(), app.settings.get().timeZone),
          yearly: app.settings.get().story?.yearly === true,
        });
      }
      if (b === 'lookback' && !c && method === 'POST') {
        const body = await readJson(req);
        const from = dateOk(body.from);
        const to = dateOk(body.to);
        if (!from || !to || from > to) throw new HttpError(400, 'Pick a start and an end date (start first).');
        if (!app.story) throw new HttpError(404, 'Look backs are not available on this server.');
        void app.story.request({ from, to }).catch((err: Error) => console.warn(`look back failed: ${err.message}`));
        return send(res, 202, { running: true });
      }
      if (b === 'lookback' && c && method === 'DELETE') {
        const m = app.memory?.get(Number(c));
        if (!m || m.kind !== 'reflection' || !m.evidence?.startsWith('lookback:')) throw new HttpError(404, 'Look back not found');
        app.memory!.delete(m.id);
        return send(res, 200, { ok: true });
      }
    }

    if (a === 'review') {
      const view = () => {
        const { lastDay, ...cfg } = reviewSettings(app);
        return { ...cfg, lastDay: lastDay ?? null };
      };
      if (!b && method === 'GET') return send(res, 200, await view());
      if (!b && method === 'PUT') {
        const body = await readJson(req);
        const next = { ...reviewSettings(app) };
        if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
        if (body.day !== undefined) {
          const d = Number(body.day);
          if (!Number.isInteger(d) || d < 0 || d > 6) throw new HttpError(400, 'Pick a day of the week.');
          next.day = d;
        }
        if (body.time !== undefined) {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time))) throw new HttpError(400, 'Time must look like 18:00.');
          next.time = String(body.time);
        }
        app.settings.update({ weeklyReview: next });
        return send(res, 200, await view());
      }
      if (b === 'now' && method === 'POST') {
        if (!app.review) throw new HttpError(404, 'Not available');
        if (opts.demo) throw new HttpError(403, 'Not in the demo.');
        return send(res, 200, await app.review.send());
      }
    }
    // Phase 20: leave-by reminders.
    if (a === 'leave-by') {
      const view = () => {
        const { sent: _sent, ...cfg } = leaveBySettings(app);
        return { ...cfg, calendar: Boolean(app.google?.status().calendar) };
      };
      if (!b && method === 'GET') return send(res, 200, await view());
      if (!b && method === 'PUT') {
        const body = await readJson(req);
        const next = { ...leaveBySettings(app) };
        if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
        if (body.mode !== undefined) next.mode = body.mode === 'bike' ? 'bike' : body.mode === 'foot' ? 'foot' : 'car';
        if (body.bufferMin !== undefined) next.bufferMin = Math.min(60, Math.max(0, Math.round(Number(body.bufferMin) || 0)));
        if (body.home !== undefined) {
          const q = String(body.home ?? '').trim();
          if (!q) delete next.home;
          else if (q !== next.home?.label) {
            const place = await findAddress(q).catch((err: Error) => {
              throw new HttpError(502, 'Couldn\'t look up that address: {error}', { params: { error: err.message } });
            });
            if (!place) throw new HttpError(400, "Couldn't find that address. Try the street, number and town.");
            next.home = place;
          }
        }
        if (next.enabled && !next.home) throw new HttpError(400, 'Add your home address first.');
        app.settings.update({ leaveBy: next });
        return send(res, 200, await view());
      }
    }
    if (a === 'briefing') {
      const tz = app.settings.get().timeZone;
      const view = () => {
        const cfg = briefingSettings(app);
        return { ...cfg, units: cfg.units ?? defaultUnits(tz) };
      };
      if (!b && method === 'GET') return send(res, 200, await view());
      if (!b && method === 'PUT') {
        const body = await readJson(req);
        const cur = briefingSettings(app);
        const next = { ...cur };
        if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
        if (body.time !== undefined) {
          const t = String(body.time);
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new HttpError(400, 'Time must look like 07:30.');
          if (t !== cur.time) delete next.lastDay;
          next.time = t;
        }
        if (body.units !== undefined) next.units = body.units === 'C' ? 'C' : 'F';
        if (body.place !== undefined) {
          const name = String(body.place ?? '').trim();
          if (!name) delete next.place;
          else if (name !== cur.place?.name) {
            try {
              next.place = await geocode(name);
            } catch (err) {
              throw new HttpError(400, (err as Error).message);
            }
          }
        }
        app.settings.update({ briefing: next });
        return send(res, 200, await view());
      }
      if (b === 'send' && method === 'POST') {
        if (!app.briefing) throw new HttpError(400, 'Briefings are not available.');
        try {
          return send(res, 200, { text: await app.briefing.send() });
        } catch (err) {
          throw new HttpError(502, (err as Error).message);
        }
      }
    }
    if (a === 'scrapbook') {
      const book = app.scrapbook;
      if (!book) throw new HttpError(404, 'Scrapbook is not available');
      if (!b && method === 'GET') {
        const convs = new Map(app.store.listConversations().map((c) => [c.id, c.title]));
        return send(res, 200, { entries: book.list().map((e) => ({ ...e, conversation: e.conversationId ? (convs.get(e.conversationId) ?? null) : null })), photos: book.photos(app.store) });
      }
      if (!b && method === 'POST') {
        const body = await readJson(req);
        const messageId = body.messageId !== undefined ? Number(body.messageId) : null;
        let text = String(body.text ?? '');
        let conversationId: string | null = null;
        if (messageId !== null) {
          const m = app.store.messageById(messageId);
          if (!m) throw new HttpError(404, 'Message not found');
          if (app.store.getConversation(m.conversationId)?.partner) throw new HttpError(400, "Messages from other people's chats can't go in the scrapbook.");
          text ||= m.content;
          conversationId = m.conversationId;
        }
        if (!text.trim()) throw new HttpError(400, 'Nothing to save.');
        const kind = body.kind === 'joke' ? 'joke' : 'moment';
        return send(res, 201, book.add({ kind, text, note: String(body.note ?? ''), conversationId, messageId, addedBy: 'owner' }));
      }
      if (b && method === 'PATCH') {
        const body = await readJson(req);
        const e = book.update(Number(b), { ...(body.note !== undefined ? { note: String(body.note) } : {}), ...(body.text !== undefined ? { text: String(body.text) } : {}) });
        if (!e) throw new HttpError(404, 'Not found');
        return send(res, 200, e);
      }
      if (b && method === 'DELETE') {
        if (!book.delete(Number(b))) throw new HttpError(404, 'Not found');
        return send(res, 200, { ok: true });
      }
    }
    // Phase 51: bring your history (a ChatGPT or Claude export): preview, import, learn, undo.
    if (a === 'history-import') {
      const hi = (app.historyImport ??= new HistoryImporter(() => app));
      if (!b && method === 'GET') return send(res, 200, hi.status());
      if (b === 'preview' && method === 'POST') {
        if (Number(req.headers['content-length'] ?? 0) > MAX_HISTORY_BYTES) throw new HttpError(413, 'That file is bigger than 500 MB.');
        // Security review (L3): one upload at a time; the export is read once and kept for run.
        let path: string;
        try {
          path = hi.uploadPath();
        } catch (err) {
          res.setHeader('connection', 'close');
          res.once('finish', () => req.socket.destroy());
          throw new HttpError(409, (err as Error).message);
        }
        try {
          try {
            const size = await saveUpload(req, path, MAX_HISTORY_BYTES);
            if (!size) throw new HttpError(400, 'That file is empty.');
          } catch (err) {
            if ((err as { code?: string }).code === 'TOO_BIG') throw new HttpError(413, 'That file is bigger than 500 MB.');
            throw err;
          }
          try {
            return send(res, 200, hi.preview(path));
          } catch (err) {
            throw new HttpError(400, (err as Error).message);
          }
        } finally {
          hi.uploadDone(path);
        }
      }
      if (b === 'run' && method === 'POST') {
        const body = await readJson(req);
        const o = (body.options ?? {}) as Record<string, unknown>;
        try {
          return send(res, 200, await hi.run(String(body.id ?? ''), { learn: o.learn !== false, oldestFirst: o.oldestFirst !== false }));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (b === 'pause' && method === 'POST') return send(res, 200, hi.pause());
      if (b === 'resume' && method === 'POST') return send(res, 200, hi.resume());
      if (b === 'cancel' && method === 'POST') return send(res, 200, hi.cancel());
      if (b === 'learn' && method === 'POST') {
        try {
          return send(res, 200, hi.learnRest());
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      if (!b && method === 'DELETE') {
        const src = new URL(req.url ?? '/', 'http://x').searchParams.get('source');
        const r = hi.remove(isHistorySource(src) ? src : undefined);
        app.uploads?.prune(app.store.imagesInUse());
        return send(res, 200, { ...r, status: hi.status() });
      }
      throw new HttpError(404, 'Not found');
    }
    // Phase 65: bring her from another app: read a chat file, preview, estimate, read it with the
    // background model, review, confirm. Owner only; never in the demo. Nothing is saved before confirm.
    if (a === 'import') {
      if (opts.demo) throw new HttpError(403, 'Not in the demo.');
      const ci = (app.companionImport ??= new CompanionImporter(() => app));
      const fail = (err: unknown): never => {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, (err as Error).message);
      };
      if (!b && method === 'GET') return send(res, 200, { sources: PICKABLE_SOURCES.map((id) => ({ id, name: SOURCE_NAME[id] })), maxZipBytes: MAX_ZIP_BYTES, maxFileBytes: MAX_FILE_BYTES });
      if (b === 'preview' && method === 'POST') {
        const name = String(new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? 'chat.txt').slice(0, 200);
        const max = CompanionImporter.maxBytes(name);
        const tooBig = max === MAX_ZIP_BYTES ? en('That file is bigger than 200 MB.') : en('That file is bigger than 50 MB. If it came in a zip, upload the zip (up to 200 MB).');
        if (Number(req.headers['content-length'] ?? 0) > max) throw new HttpError(413, tooBig);
        let path: string;
        try {
          path = ci.uploadPath();
        } catch (err) {
          res.setHeader('connection', 'close');
          res.once('finish', () => req.socket.destroy());
          throw new HttpError(409, (err as Error).message);
        }
        try {
          try {
            if (!(await saveUpload(req, path, max))) throw new HttpError(400, 'That file is empty.');
          } catch (err) {
            if ((err as { code?: string }).code === 'TOO_BIG') throw new HttpError(413, tooBig);
            throw err;
          }
          try {
            return send(res, 200, ci.preview(path, name));
          } catch (err) {
            return fail(err);
          }
        } finally {
          ci.uploadDone(path);
        }
      }
      if (b && b !== 'preview') {
        try {
          if (!c && method === 'GET') return send(res, 200, ci.status(b));
          if (!c && method === 'DELETE') {
            ci.discard(b);
            return send(res, 200, { ok: true });
          }
          if (method === 'POST' && (c === 'estimate' || c === 'start' || c === 'cancel' || c === 'confirm')) {
            const body = await readJson(req);
            const choice = { conversations: body.conversations, roles: body.roles, source: body.source, localOnly: body.localOnly !== false };
            if (c === 'estimate') return send(res, 200, ci.estimate(b, choice));
            if (c === 'start') return send(res, 200, ci.start(b, { ...choice, useModel: body.useModel !== false }));
            if (c === 'cancel') return send(res, 200, ci.cancel(b));
            return send(res, 200, ci.confirm(b, body as ConfirmInput));
          }
        } catch (err) {
          return fail(err);
        }
      }
      throw new HttpError(404, 'Not found');
    }
    // Phase 51: ready-made characters to start from (each one a shareable character file).
    if (a === 'gallery') {
      if (!b && method === 'GET') return send(res, 200, { characters: galleryList() });
      if (b && c === 'try' && method === 'POST') {
        const g = galleryEntry(b);
        if (!g) throw new HttpError(404, 'No such character');
        try {
          return send(res, 200, { id: g.id, line: await galleryLine(app, g) });
        } catch (err) {
          // M1: in setup the character comes before the model; a friendly answer, not a logged 500.
          if (err instanceof NoBrainError) throw new HttpError(409, err.message);
          throw err;
        }
      }
      throw new HttpError(404, 'Not found');
    }
    // Phase 44: her library (documents she keeps, or reads once for one conversation).
    if (a === 'library') {
      const lib = app.library;
      if (!lib) throw new HttpError(404, 'The library is not available');
      const docView = (d: LibraryDoc) => ({ ...d, sha: undefined, facts: d.facts });
      if (!b && method === 'GET') {
        const t = embedTarget(app);
        const counts = lib.counts();
        return send(res, 200, {
          docs: lib.list().map(docView),
          counts,
          meaning: t ? { model: t.model, indexed: lib.vectorCount(t.model), total: counts.passages, error: lib.vectorError ?? null } : null,
          shared: app.settings.get().companionLibrary === 'shared',
          maxBytes: MAX_DOC_BYTES,
          supported: SUPPORTED,
        });
      }
      // Upload: the file's bytes as the body; name, keep and conversation in the query.
      if (!b && method === 'POST') {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        const name = q.get('name') ?? 'document';
        const keep = q.get('keep') !== '0';
        const conversationId = q.get('conversation') || null;
        if (conversationId) {
          if (offStore.getConversation(conversationId)) throw new HttpError(400, "Off-the-record chats don't save files, so documents can't be shared here.");
          const conv = app.store.getConversation(conversationId);
          if (!conv || conv.partner) throw new HttpError(404, 'Conversation not found');
        }
        const bytes = await readRaw(req, MAX_DOC_BYTES);
        if (!bytes.length) throw new HttpError(400, 'That file is empty.');
        if (!detectKind(name, bytes)) throw new HttpError(415, 'She can\'t read that kind of file. She reads {kinds}.', { params: { kinds: SUPPORTED.map((k) => k.label).join(', ') } });
        if (keep) {
          const had = lib.findKept(bytes);
          if (had) return send(res, 200, { doc: docView(had), already: true });
        }
        const doc = lib.add({ name, bytes, keep, conversationId: keep ? null : conversationId, origin: keep && !conversationId ? 'library' : 'chat', learn: q.get('learn') !== '0' });
        app.libraryNudge?.();
        app.events?.publish({ type: 'library', id: doc.id });
        return send(res, 201, { doc: docView(doc) });
      }
      if (b === 'search' && method === 'GET') {
        const q = new URL(req.url ?? '/', 'http://x').searchParams.get('q')?.trim() ?? '';
        if (!q) return send(res, 200, { hits: [] });
        const hits = await lib.find(q, { target: embedTarget(app), limit: 10, timeoutMs: 4000 });
        return send(res, 200, { hits: hits.map((h) => ({ docId: h.doc.id, name: h.doc.name, place: h.passage.place, heading: h.passage.heading, text: h.passage.text, ord: h.passage.ord, by: h.by })) });
      }
      if (b === 'settings' && method === 'PUT') {
        const body = await readJson(req);
        if (body.shared !== undefined) app.settings.update({ companionLibrary: body.shared ? 'shared' : 'separate' });
        return send(res, 200, { shared: app.settings.get().companionLibrary === 'shared', restart: (app.companions?.all().length ?? 1) > 1 });
      }
      const id = Number(b);
      const doc = Number.isInteger(id) ? lib.get(id) : undefined;
      if (b && !doc) throw new HttpError(404, 'Not found');
      if (doc) {
        if (!c && method === 'GET') {
          const facts = app.memory?.fromDoc(doc.id).filter((m) => m.supersededBy === null) ?? [];
          return send(res, 200, { doc: docView(doc), facts: facts.map((m) => ({ id: m.id, content: m.content, evidence: m.evidence })), passages: lib.passages(doc.id, { limit: 40 }) });
        }
        if (c === 'passages' && method === 'GET') {
          const q = new URL(req.url ?? '/', 'http://x').searchParams;
          return send(res, 200, { passages: lib.passages(doc.id, { from: Number(q.get('from') ?? 0) || 0, limit: Math.min(200, Number(q.get('limit') ?? 40) || 40) }) });
        }
        if (c === 'file' && method === 'GET') {
          const bytes = lib.file(doc);
          if (!bytes) throw new HttpError(404, 'The original file is missing');
          const ascii = doc.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`, 'content-length': bytes.length, 'cache-control': 'no-store', ...SECURITY_HEADERS });
          return void res.end(bytes);
        }
        if (!c && method === 'PATCH') {
          const body = await readJson(req);
          if (typeof body.name === 'string' && body.name.trim()) lib.rename(doc.id, body.name);
          if (body.keep === true && !doc.keep) lib.keep(doc.id, body.learn !== false);
          app.libraryNudge?.();
          return send(res, 200, { doc: docView(lib.get(doc.id)!) });
        }
        if (c === 'reread' && method === 'POST') {
          lib.setStatus(doc.id, 'waiting');
          if (doc.keep) lib.setLearn(doc.id, 'waiting');
          app.libraryNudge?.();
          return send(res, 200, { doc: docView(lib.get(doc.id)!) });
        }
        if (c === 'learn' && method === 'POST') {
          if (!doc.keep) throw new HttpError(400, 'Keep it in her library first.');
          lib.setLearn(doc.id, 'waiting');
          app.libraryNudge?.();
          return send(res, 200, { doc: docView(lib.get(doc.id)!) });
        }
        if (!c && method === 'DELETE') {
          // What she learned from it is forgotten too, if the owner asks.
          // Only the notes learned from this document go: not chat messages that mention the same
          // things (that is what forgetting something said in a conversation does).
          let forgotten = 0;
          if (new URL(req.url ?? '/', 'http://x').searchParams.get('forget') === '1' && app.memory) {
            for (const m of app.memory.fromDoc(doc.id)) {
              if (app.memory.delete(m.id)) forgotten++;
              app.vectors?.forget(m.id);
            }
            app.events?.publish({ type: 'memory', conversationId: '' });
          }
          lib.delete(doc.id);
          app.events?.publish({ type: 'library', id: doc.id });
          return send(res, 200, { ok: true, forgotten });
        }
      }
    }
    if (a === 'photos' && !b) {
      const view = () => {
        const p = photoSettings(app.settings);
        const xai = app.settings.get().providers.find((x) => /api\.x\.ai/.test(x.baseUrl));
        return { mode: p.mode, model: p.model || DEFAULT_IMAGE_MODEL, hasKey: app.vault.has(PHOTO_KEY_VAULT), grokSubscription: app.subscriptions?.grokStatus().signedIn ?? false, providerKey: Boolean(xai && app.vault.get(vaultKeyFor(xai.id))), taken: (p.taken ?? []).slice(0, 12) };
      };
      if (method === 'GET') return send(res, 200, await view());
      if (method === 'PUT') {
        const body = await readJson(req);
        const cur = photoSettings(app.settings);
        const mode = body.mode === 'off' || body.mode === 'set' || body.mode === 'new' ? body.mode : cur.mode;
        const model = body.model !== undefined ? String(body.model).trim().slice(0, 80) || undefined : cur.model;
        if (typeof body.key === 'string' && body.key.trim()) app.vault.set(PHOTO_KEY_VAULT, body.key.trim());
        if (body.key === null) app.vault.delete(PHOTO_KEY_VAULT);
        app.settings.update({ photos: { ...cur, mode, model } });
        return send(res, 200, await view());
      }
    }
    if (a === 'uploads' && b && !c && method === 'GET') {
      const f = app.uploads?.get(b);
      if (!f) throw new HttpError(404, 'Not found');
      res.writeHead(200, { 'content-type': f.mime, 'cache-control': 'private, max-age=31536000, immutable', ...SECURITY_HEADERS });
      return void createReadStream(f.path).pipe(res);
    }
    if (a === 'find' && method === 'GET') {
      const sp = new URL(req.url ?? '/', 'http://x').searchParams;
      const q = (sp.get('q') ?? '').trim().slice(0, 200);
      // Phase 22: ?all=1 searches everything, grouped (conversations, memories, notes, to-dos,
      // scrapbook, workspace files). Without it: conversations only (older clients).
      if (sp.get('all') === '1') return send(res, 200, findEverything(app, q, { files: !opts.demo }));
      return send(res, 200, q ? app.store.search(q) : []);
    }
    if (a === 'tags' && !b && method === 'GET') return send(res, 200, { tags: app.store.allTags() });
    if (a === 'conversations') {
      if (!b && method === 'GET') {
        const mine = (id: string) => !opts.demo || demoOwner.get(id) === visitorKey(req);
        const off = offStore.listConversations().filter((c) => mine(c.id)).map((c) => ({ ...c, offRecord: true, working: active.has(c.id) }));
        return send(res, 200, opts.demo ? off : [...off, ...app.store.listConversations().map((c) => ({ ...c, working: active.has(c.id) }))]);
      }
      if (!b && method === 'POST') {
        const body = await readJson(req);
        if (body.offRecord || opts.demo) {
          const conv = offStore.createConversation({ title: opts.demo ? 'New conversation' : 'Off the record' });
          if (opts.demo) demoOwner.set(conv.id, visitorKey(req));
          return send(res, 201, { ...conv, offRecord: true });
        }
        const project = body.projectId !== undefined && body.projectId !== null ? projectOrThrow(body.projectId) : null;
        return send(
          res,
          201,
          app.store.createConversation({
            providerId: body.providerId ? String(body.providerId) : null,
            model: body.model ? String(body.model) : null,
            projectId: project?.id ?? null,
            // A project's workspace is the default for its new conversations.
            ...(body.workspace !== undefined ? { workspace: validWorkspace(body.workspace) } : project?.workspace ? { workspace: project.workspace } : {}),
            ...(body.mode !== undefined ? { mode: validMode(body.mode) } : {}),
            ...(body.private !== undefined ? { private: Boolean(body.private) } : {}),
          }),
        );
      }
      if (b) {
        const cx = ctxOf(b);
        const offRecord = cx !== app;
        // Demo visitors only ever see their own conversations.
        if (opts.demo && (!offRecord || demoOwner.get(b) !== visitorKey(req))) throw new HttpError(404, 'Conversation not found');
        const conv = cx.store.getConversation(b);
        if (!conv) throw new HttpError(404, 'Conversation not found');
        const view = (m: StoredMessage) => ({
          ...m,
          content: m.role === 'notice' ? m.content.replace(/^\w+:/, '') : m.role === 'tool' ? clip(app.redactor.redact(m.content), 4000) : m.content,
          ...(m.meta ? { meta: app.redactor.redactValue(m.meta) } : {}),
          kind: m.role === 'notice' ? m.content.split(':')[0] : undefined,
        });
        const pageOpts = () => {
          const sp = new URL(req.url ?? '/', 'http://x').searchParams;
          const limit = sp.has('limit') ? Math.min(1000, Math.max(20, Number(sp.get('limit')) || 150)) : undefined;
          const before = sp.has('before') ? Number(sp.get('before')) || undefined : undefined;
          return { limit, before };
        };
        // Phase 22: pins (shown above the conversation, wherever they are in it).
        const pins = () => cx.store.pinnedMessages(b).map((m) => ({ id: m.id, role: m.role, snippet: m.content.replace(/\s+/g, ' ').slice(0, 160), createdAt: m.createdAt }));
        // Phase 37: what you're doing together in this conversation.
        if (c === 'together' && cx.together) {
          if (method === 'GET') return send(res, 200, { activity: cx.together.activity(b) ?? null });
          if (method === 'POST') {
            const body = await readJson(req);
            if (conv.partner) throw new HttpError(400, 'Not in chats with other people.');
            try {
              cx.together.start(b, String(body.kind ?? ''), typeof body.topic === 'string' ? body.topic : undefined);
            } catch (err) {
              throw new HttpError(400, (err as Error).message);
            }
            return send(res, 200, { activity: cx.together.activity(b) });
          }
          if (method === 'DELETE') {
            cx.together.end(b);
            return send(res, 200, { activity: null });
          }
        }
        if (!c && method === 'GET') {
          // Phase 22: ?limit=N sends only the latest N messages (long conversations load fast);
          // without it, everything (phone apps and older clients).
          const { limit } = pageOpts();
          const page = limit ? cx.store.messagesPage(b, { limit }) : { messages: cx.store.messages(b), earlier: 0 };
          return send(res, 200, { ...conv, ...(offRecord ? { offRecord: true } : {}), messages: page.messages.map(view), earlier: page.earlier, pinned: pins(), activity: activityView(b), together: cx.together?.activity(b) ?? null });
        }
        if (c === 'messages' && !parts[3] && method === 'GET') {
          const { limit, before } = pageOpts();
          const page = cx.store.messagesPage(b, { limit: limit ?? 150, ...(before ? { before } : {}) });
          return send(res, 200, { messages: page.messages.map(view), earlier: page.earlier });
        }
        if (c === 'messages' && parts[3] && !parts[4] && method === 'PATCH') {
          const body = await readJson(req);
          const m = cx.store.messageById(Number(parts[3]));
          if (!m || m.conversationId !== b) throw new HttpError(404, 'Message not found');
          if (body.pinned !== undefined) {
            if (m.role !== 'user' && m.role !== 'assistant') throw new HttpError(400, 'Only messages from you or her can be pinned.');
            if (body.pinned === true && cx.store.pinnedMessages(b).length >= 50) throw new HttpError(400, 'Up to 50 pinned messages per conversation.');
            cx.store.updateMessageMeta(m.id, { pinned: body.pinned === true });
          }
          return send(res, 200, { pinned: pins() });
        }
        if (!c && method === 'PATCH') {
          const body = await readJson(req);
          return send(
            res,
            200,
            cx.store.updateConversation(b, {
              ...(body.title !== undefined ? { title: String(body.title).slice(0, 120) } : {}),
              // Demo visitors keep the model the demo was set up with.
              ...(body.providerId !== undefined && !opts.demo ? { providerId: body.providerId ? String(body.providerId) : null } : {}),
              ...(body.model !== undefined && !opts.demo ? { model: body.model ? String(body.model) : null } : {}),
              ...(body.workspace !== undefined ? { workspace: validWorkspace(body.workspace) } : {}),
              ...(body.mode !== undefined ? { mode: validMode(body.mode) } : {}),
              ...(body.private !== undefined ? { private: Boolean(body.private) } : {}),
              ...(body.projectId !== undefined ? { projectId: body.projectId === null ? null : projectOrThrow(body.projectId).id } : {}),
              ...(body.archived !== undefined ? { archived: Boolean(body.archived) } : {}),
              ...(body.tags !== undefined ? { tags: tagsOrThrow(body.tags) } : {}),
            }),
          );
        }
        if (!c && method === 'DELETE') {
          active.get(b)?.controller.abort();
          // What she learned from it stays unless the owner asks her to forget it too.
          const forgotten = new URL(req.url ?? '/', 'http://x').searchParams.get('forget') === '1' && cx.memory ? cx.memory.deleteForConversation(b) : 0;
          cx.store.deleteConversation(b);
          // Documents read once in it go too (kept ones stay in her library).
          cx.library?.deleteForConversation(b);
          app.uploads?.prune(app.store.imagesInUse());
          app.events?.publish({ type: 'memory', conversationId: b });
          return send(res, 200, { ok: true, forgotten });
        }
        if (c === 'memories' && method === 'GET') return send(res, 200, { count: cx.memory?.countForConversation(b) ?? 0 });
        // Phase 52: tokens and estimated cost of this conversation (the line under the chat).
        if (c === 'usage' && method === 'GET') {
          const u = cx.usage?.forConversation(b);
          return send(res, 200, u ? { ...u, line: usageLine(u) } : { calls: 0, line: '' });
        }
        if (c === 'remember' && method === 'POST') {
          if (!cx.memory) throw new HttpError(404, 'Memory is not available');
          if (active.has(b)) throw new HttpError(409, me('Sara is still working in this conversation.'), { errorKey: 'Sara is still working in this conversation.' });
          const r = await summarizeConversation(cx, cx.memory, b);
          if (r.error) throw new HttpError(502, 'Couldn\'t write the summary: {error}', { params: { error: r.error } });
          return send(res, 200, r);
        }
        if (c === 'stop' && method === 'POST') {
          const t = active.get(b);
          t?.controller.abort();
          return send(res, 200, { stopped: Boolean(t) });
        }
        if (c === 'messages' && method === 'POST') {
          requireDisclosure(req);
          // Photos are refused off the record and in the demo, so those never need the big limit.
          const body = await readJson(req, offRecord || opts.demo ? MAX_BODY : PHOTO_BODY);
          if (offRecord && Array.isArray(body.images) && body.images.length) throw new HttpError(400, "Photos can't be sent off the record (they would be saved).");
          const images = savePhotos(body.images);
          // Phase 44: documents uploaded to her library (or for this chat) just before sending.
          const docs = Array.isArray(body.docs)
            ? body.docs.slice(0, 10).flatMap((v) => {
                const d = app.library?.get(Number(v));
                return d && (d.keep || d.conversationId === b) ? [{ id: d.id, name: d.name, keep: d.keep }] : [];
              })
            : [];
          const content = String(body.content ?? '').trim() || (images.length ? '(photo)' : docs.length ? '(document)' : '');
          if (!content) throw new HttpError(400, 'Message is empty');
          if (content.length > 100_000) throw new HttpError(413, 'Message too long');
          demoTurnAllowed(req);
          // Phase 18: from a notification's Reply box or the share sheet, the phone doesn't wait.
          // The reply arrives like her other messages: as an event, so as a notification too.
          if (body.background === true) {
            if (active.has(b)) throw new HttpError(409, me('Sara is still working on this conversation. Wait for her or press Stop.'), { errorKey: 'Sara is still working on this conversation. Wait for her or press Stop.' });
            void runBackground(b, content, { ...(images.length ? { images } : {}), ...(docs.length ? { docs } : {}) });
            return send(res, 202, { ok: true });
          }
          return streamChat(req, res, b, content, { ...(images.length ? { images } : {}), ...(docs.length ? { docs } : {}) });
        }
        // Regenerate the last reply, or edit the last owner message and answer it again.
        if (c === 'retry' && method === 'POST') {
          requireDisclosure(req);
          if (active.has(b)) throw new HttpError(409, me('Sara is still working on this conversation. Wait for her or press Stop.'), { errorKey: 'Sara is still working on this conversation. Wait for her or press Stop.' });
          const body = await readJson(req);
          const lastUser = cx.store.messages(b).filter((m) => m.role === 'user').at(-1);
          if (!lastUser) throw new HttpError(400, 'There is no message to answer again.');
          const content = body.content !== undefined ? String(body.content) : lastUser.content;
          if (!content.trim()) throw new HttpError(400, 'Message is empty');
          if (content.length > 100_000) throw new HttpError(413, 'Message too long');
          // Photos stay with the message when it is regenerated or edited.
          const images = Array.isArray(lastUser.meta?.images) ? (lastUser.meta.images as string[]) : [];
          cx.store.deleteMessagesFrom(b, lastUser.id);
          return streamChat(req, res, b, content, images.length ? { images } : {});
        }
        // Continue a reply that was cut off (restart, error, stop) without a new message.
        if (c === 'continue' && method === 'POST') {
          requireDisclosure(req);
          const lastUser = cx.store.messages(b).filter((m) => m.role === 'user').at(-1);
          if (!lastUser) throw new HttpError(400, 'Nothing to continue.');
          return streamChat(req, res, b, lastUser.content, { resume: true });
        }
      }
    }

    throw new HttpError(404, 'Not found');
  }

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    // Over https, browsers are told to keep using https for this site (a year).
    if (isHttps(req)) res.setHeader('strict-transport-security', 'max-age=31536000');
    try {
      // Phase 49: app previews, authorised by the token in the address only (never the session
      // cookie), from the raw request target (not normalised). See src/preview.ts.
      const rawTarget = req.url ?? '/';
      if (rawTarget === '/preview' || rawTarget.startsWith('/preview/') || rawTarget.startsWith('/preview?')) {
        if (!app.previews || opts.demo) throw new HttpError(404, 'Not found');
        return await app.previews.handle(req, res, rawTarget);
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Phase 57: other apps, with an API key: the OpenAI-compatible API and the MCP server.
      if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
        return await handleOpenAI(req, res, url.pathname, { app, auth, ...(opts.companions ? { companions: opts.companions } : {}), demo: Boolean(opts.demo), limiter: appLimiter });
      }
      if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
        return await handleMcp(req, res, { app, auth, demo: Boolean(opts.demo), version: info.version, limiter: appLimiter, requestApproval });
      }
      if (url.pathname.startsWith('/api/')) {
        const parts = url.pathname.slice(5).split('/').filter(Boolean).map(safeDecode);
        await api(req, res, method, parts);
      } else if (method === 'GET' || method === 'HEAD') {
        await serveStatic(req, res, url.pathname);
      } else {
        throw new HttpError(405, 'Method not allowed');
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? en('Internal error') : (err as Error).message, ...(err instanceof HttpError ? err.extra : {}) });
      else res.end();
    }
  });

  // Keep idle connections longer than Node's 5 s default: apps (SillyTavern, the API, MCP clients,
  // a reverse proxy) reuse a connection between messages, and a reuse racing the server's close
  // fails with "connection reset". 65 s is longer than common proxies' own idle limit.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  // Live voice calls: /api/live/<conversation id> upgrades to a WebSocket (owner only, same site).
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const m = /^\/api\/live\/([^/]+)$/.exec(url.pathname);
      if (!m) return refuseUpgrade(socket, 404, 'Not Found');
      const origin = req.headers.origin;
      let originHost = '';
      try {
        originHost = origin ? new URL(origin).host : '';
      } catch {
        return refuseUpgrade(socket, 403, 'Forbidden');
      }
      if (origin && originHost !== req.headers.host) return refuseUpgrade(socket, 403, 'Forbidden');
      if (!isAuthed(req)) return refuseUpgrade(socket, 401, 'Unauthorized');
      let convId = '';
      try {
        convId = safeDecode(m[1]);
      } catch {
        return refuseUpgrade(socket, 404, 'Not Found');
      }
      // Demo (app review): only with the reviewer code, in the visitor's own conversation, within
      // the per-call and daily limits; never answering a ring (she doesn't call in the demo).
      if (opts.demo) {
        const visitor = visitorKey(req);
        if (!demoCalls.enabled) return refuseUpgrade(socket, 403, 'Forbidden');
        if (!offStore.getConversation(convId) || demoOwner.get(convId) !== visitor) return refuseUpgrade(socket, 404, 'Not Found');
        if (!demoAccepted.has(visitor) || !demoCalls.unlocked(visitor) || url.searchParams.get('ring')) return refuseUpgrade(socket, 403, 'Forbidden');
        const choice = speech.liveChoice();
        let key: string | undefined;
        try {
          key = choice.engine ? await speech.liveKey(choice.engine) : undefined;
        } catch (err) {
          console.error('demo live call key:', (err as Error).message);
        }
        const ws = acceptWebSocket(req, socket, head);
        if (!ws) return;
        if (!key || !choice.engine) {
          ws.send(JSON.stringify({ type: 'ended', reason: 'Live calls are not available on the demo right now.' }));
          return ws.close(1000);
        }
        if (liveCall && !liveCall.ended) {
          ws.send(JSON.stringify({ type: 'ended', reason: 'Another demo call is going on. Try again in a few minutes.' }));
          return ws.close(1000);
        }
        const go = demoCalls.begin(visitor);
        if (!go.ok) {
          ws.send(JSON.stringify({ type: 'ended', reason: go.reason }));
          return ws.close(1000);
        }
        const minutes = Math.max(1, Math.round(go.maxMs / 60_000));
        // Hardening L3: if setting the call up throws, the demo call slot is freed (not stuck until a restart).
        try {
          liveCall = new LiveCall(offApp, convId, ws, key, {
            engine: choice.engine,
            ...(opts.liveConnect ? { connect: opts.liveConnect } : {}),
            maxMs: go.maxMs,
            maxReason: go.byBudget ? 'That’s all the demo calling for today. Try again tomorrow.' : `Demo calls last up to ${minutes} minute${minutes === 1 ? '' : 's'}.`,
            onEnd: () => go.done(),
          });
          liveCall.start();
        } catch (err) {
          go.done();
          console.error('demo live call:', (err as Error).message);
          const why = 'The call couldn’t start. Try again in a moment.';
          if (liveCall && !liveCall.ended) liveCall.end(why);
          else {
            try {
              ws.send(JSON.stringify({ type: 'ended', reason: why }));
              ws.close(1000);
            } catch {
              /* already closed */
            }
          }
        }
        return;
      }
      const conv = app.store.getConversation(convId);
      if (!conv || conv.partner) return refuseUpgrade(socket, 404, 'Not Found');
      if (!app.settings.get().disclosureAcceptedAt) return refuseUpgrade(socket, 403, 'Forbidden');
      // Security review: a private conversation only goes to hardware the owner controls, and live
      // calls run on a cloud voice service (her character, memories and earlier lines would go
      // along). Say so plainly instead of calling.
      if (conv.private) {
        const pws = acceptWebSocket(req, socket, head);
        if (!pws) return;
        const r = url.searchParams.get('ring');
        if (r) app.calls?.decline(r);
        pws.send(JSON.stringify({ type: 'ended', reason: me('Live calls are off in private conversations: the call would go through a cloud voice service. Use voice notes or a normal conversation for a call.'), private: true }));
        return pws.close(1000);
      }
      // Phase 48: Grok or OpenAI, per Settings → Voice → "Live calls with".
      const choice = speech.liveChoice();
      let key: string | undefined;
      try {
        key = choice.engine ? await speech.liveKey(choice.engine) : undefined;
      } catch (err) {
        key = undefined;
        console.error('live call key:', (err as Error).message);
      }
      const ws = acceptWebSocket(req, socket, head);
      if (!ws) return;
      if (!key || !choice.engine) {
        // Her call can't connect: stop ringing everywhere, and she sends it as a message.
        const r = url.searchParams.get('ring');
        if (r) app.calls?.decline(r);
        ws.send(JSON.stringify({ type: 'ended', reason: me(choice.engine ? 'The voice service sign-in could not be used; check Settings → Voice.' : choice.message) }));
        return ws.close(1000);
      }
      // Answering a call from her: the first device wins; she starts by saying why she called.
      const ringId = url.searchParams.get('ring');
      let opening: string | undefined;
      if (ringId) {
        const ring = app.calls?.answer(ringId, deviceLabel(req.headers['user-agent']));
        if (!ring || ring.conversationId !== conv.id) {
          ws.send(JSON.stringify({ type: 'ended', reason: 'This call was already answered or has ended.' }));
          return ws.close(1000);
        }
        opening = openingNote(ring, app.settings.get().ownerName?.trim() || 'the owner');
      }
      liveCall?.end('A new call started on another device.');
      liveCall = new LiveCall(app, conv.id, ws, key, { engine: choice.engine, ...(opts.liveConnect ? { connect: opts.liveConnect } : {}), ...(opening ? { opening } : {}) });
      liveCall.start();
    })().catch((err) => {
      console.error('live call failed:', err);
      socket.destroy();
    });
  });
  return server;
}

/** Phase 38: up to two backup models ({providerId, model}) from a request, checked. */
function cleanModelList(v: unknown, localOnly: boolean): { providerId: string; model: string }[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'Backups must be a list.');
  return v.slice(0, 2).flatMap((x) => {
    const r = (x ?? {}) as { providerId?: unknown; model?: unknown };
    const providerId = String(r.providerId ?? '');
    const model = String(r.model ?? '').trim().slice(0, 200);
    if (!providerId || !model) return [];
    if (localOnly && isCloudModel(model)) throw new HttpError(400, '{model} is an Ollama cloud model; private conversations need a model on your own hardware.', { params: { model } });
    return [{ providerId, model }];
  });
}
