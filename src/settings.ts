// Non-secret owner settings, stored as JSON in the data directory.
import type { BriefingSettings } from './briefing.ts';
import type { OffsiteSettings } from './offsite.ts';
import type { PhotoSettings } from './photos.ts';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderConfig } from './providers/types.ts';
import type { MemorySettings } from './memory-worker.ts';
import type { ProactiveSettings } from './life.ts';
import type { VoiceSettings } from './voice.ts';
import type { TelegramSettings } from './bridges/telegram.ts';
import type { PushSettings } from './push.ts';
import type { BackupSettings } from './backup.ts';
import type { DiscordSettings } from './bridges/discord.ts';

/**
 * Jobs a model can be pointed at (Phase 38 added vision, planning, writing, research, quick and
 * embeddings). Pictures, hearing and her voice have their own pages (Pictures, Voice).
 */
export type RoutePurpose = 'chat' | 'coding' | 'background' | 'private' | 'adult' | 'vision' | 'planning' | 'writing' | 'research' | 'quick' | 'embeddings';
export const ROUTE_PURPOSES: readonly RoutePurpose[] = ['chat', 'coding', 'background', 'private', 'adult', 'vision', 'planning', 'writing', 'research', 'quick', 'embeddings'];
/** A model for a job, with up to two others to take over if it fails or is slow (Phase 38). */
export interface ModelRoute {
  providerId: string;
  model: string;
  fallbacks?: { providerId: string; model: string }[];
}
import type { McpServerConfig } from './tools/mcp.ts';
import type { SearchProvider } from './tools/search.ts';
import type { Permission } from './tools/types.ts';

export interface Settings {
  providers: ProviderConfig[];
  defaultProviderId?: string;
  defaultModel?: string;
  /** What Sara should call the owner. */
  ownerName?: string;
  /** IANA time zone used for Sara's sense of time. */
  timeZone?: string;
  /** When the owner accepted the AI and content disclosure (ISO time). */
  disclosureAcceptedAt?: string;
  /** The first-run setup guide was finished or skipped (Phase 10). */
  setupDone?: boolean;
  /** Per-tool permission overrides (tool name → auto/ask/never). */
  toolPermissions?: Record<string, Permission>;
  /** Allow shell commands network access inside the sandbox. Default true. */
  shellNetwork?: boolean;
  /** Web search backend (key, if any, is in the vault under search:<provider>). */
  search?: { provider: SearchProvider; url?: string };
  /** MCP servers (secrets for env/headers are in the vault under mcp:<name>). */
  mcpServers?: McpServerConfig[];
  /** Pictures from Sara (Phase 9). */
  photos?: Partial<PhotoSettings>;
  /** Phase 36: her closet (dress automatically, work hours, own scenarios, picked scenario). */
  wardrobe?: Partial<import('./wardrobe.ts').WardrobeSettings>;
  /** Phase 36: keep her face from the locked picture in every outfit and change (default on). */
  faceLock?: boolean;
  /** Off-server encrypted backup copies (Phase 8). */
  offsite?: Partial<OffsiteSettings>;
  /** Morning briefing (Phase 8). */
  briefing?: Partial<BriefingSettings>;
  /** How much of a conversation is sent to the model each turn (characters; ~4 per token). */
  historyBudgetChars?: number;
  /** Long-term memory settings (Phase 3). */
  memory?: Partial<MemorySettings>;
  /** Which model handles what (Phase 4). A conversation's own model choice still wins. */
  routes?: Partial<Record<RoutePurpose, ModelRoute>>;
  /** Phase 38: seconds to wait for a model's first word before the next one takes over (default 60). */
  fallbackAfterSec?: number;
  /** Phase 38: fallbacks for the default model (used for any job without its own route). */
  defaultFallbacks?: { providerId: string; model: string }[];
  /** Phase 40: GitHub repositories watched for new issues (off by default). */
  githubWatch?: import('./issues.ts').GitHubWatch;
  /** Phase 39: helpers the owner made (Team page). */
  helpers?: import('./team.ts').CustomHelper[];
  /** Phase 39: default limits for a team task. */
  teamLimits?: Partial<import('./team.ts').TeamLimits>;
  /** Phase 52: the owner's own model prices (USD per 1M tokens; they win over the shipped defaults). */
  prices?: import('./usage.ts').PriceRow[];
  /** Phase 52: default budget for a background job that uses a model (Claude Code / Grok Build). */
  jobBudget?: import('./usage.ts').Budget;
  /** Phase 38, per companion: the model she thinks with for conversation (else the chat job / default). */
  companionModel?: { providerId: string; model: string };
  /** Persona engine switches (Phase 4). */
  /** typing: on Telegram/Discord, wait like a person typing before each message (Phase 11). */
  /** inCharacter (Phase 34): the optional stays-in-character check (off, some replies, every reply). */
  persona?: { innerLife?: boolean; typing?: 'instant' | 'human'; inCharacter?: 'off' | 'some' | 'every' };
  /**
   * Adult mode (Phase 16, owner decision 2026-10-24). Off by default. Turned on only from a web
   * browser with the owner's 18+ confirmation (recorded). When on: no limits beyond the legal ones
   * (disclosure, honesty, crisis help, the minors block); the model's own rules are the gate.
   * `ask`: servers that had adult content before this switch existed ask the owner once.
   */
  adultMode?: { on: boolean; confirmedAt?: string; confirmedFrom?: string; ask?: boolean };
  /** Phase 20: leave-by reminders from calendar events with an address (see leaveby.ts). */
  leaveBy?: Partial<import('./leaveby.ts').LeaveBySettings>;
  /** Phase 22: weekly review (see review.ts). */
  weeklyReview?: Partial<import('./review.ts').ReviewSettings>;
  /** Phase 23: the owner hid "Getting started" on the Today page. */
  checklistHidden?: boolean;
  /** Optional local classifier backing the safety heuristics (adds protection only). */
  safetyClassifier?: { providerId: string; model: string };
  /**
   * Phase 62: optional claim judge (off when unset). A small model asked only about sentences the
   * receipt patterns are unsure about; it can only add a correction, never remove one.
   */
  claimJudge?: { providerId: string; model: string };
  /** Discord bridge (Phase 6). Bot token lives in the vault (bridge:discord). */
  discord?: Partial<DiscordSettings>;
  /** Automatic backups (Phase 6). */
  backup?: Partial<BackupSettings>;
  /** Web push notifications (Phase 6). */
  push?: Partial<PushSettings>;
  /** Telegram bridge (Phase 6). Bot token lives in the vault (bridge:telegram). */
  telegram?: Partial<TelegramSettings>;
  /** Voice (Phase 5). Keys live in the vault (voice:openai, voice:elevenlabs). */
  voice?: Partial<VoiceSettings>;
  /** Messages Sara starts herself (Phase 4). */
  proactive?: Partial<ProactiveSettings>;
  /** Phase 26: what may make her call you. */
  calls?: Partial<import('./calls.ts').CallRules>;
  /** Phase 29: the owner's Home Assistant address (the access token is in the vault). */
  home?: { url: string };
  /** Phase 31: companions share the first one's planner (default) or each keeps her own. */
  companionPlanner?: 'shared' | 'separate';
  /** Phase 44: one library per companion (default) or one shared by all. */
  companionLibrary?: 'shared' | 'separate';
  /** Phase 32: companions share facts about the owner they each learned (default: each her own). */
  memorySharing?: 'own' | 'shared';
  /** Phase 53: the app language ('auto' = the browser's language, or a code from src/i18n.ts). */
  language?: string;
  /** Phase 53: the browser language the app reported while the language is Automatic. */
  languageDetected?: string;
  /** Phase 53: the language she talks in ('auto' = the language the owner writes in, else the app language). */
  talkLanguage?: string;
  /** Phase 53, per companion: the yearly look back on the anniversary of the first message (off by default). */
  story?: { yearly?: boolean; lastYear?: number };
  /**
   * Phase 56: per provider: keep its model list up to date (default on); Ollama daemons: offer every
   * Ollama Cloud model (default: on when it has a cloud model) and remove retired cloud models (off).
   */
  modelLists?: Record<string, { keepCurrent?: boolean; ollamaCloud?: boolean; removeRetired?: boolean }>;
  /** Phase 56: a retired model in use switches to its replacement (default on); off = only warn. */
  modelAutoSwitch?: boolean;
  /**
   * Phase 57: other apps with an API key (OpenAI-compatible /v1 and MCP /mcp). `tools`: her own tools
   * in their turns (off by default); `changes`: MCP write tools (off by default); `origins`: browser
   * apps on other addresses allowed to call her (CORS; none by default).
   */
  otherApps?: { tools?: boolean; changes?: boolean; origins?: string[] };
}

const FILE = 'settings.json';

/** Provider names from earlier versions, renamed to say where the provider runs. */
const RENAMED_LABELS: Record<string, string> = { 'Ollama (this server)': 'Ollama on the server', 'Ollama on the Sara server': 'Ollama on the server', 'Ollama Cloud': 'Ollama Cloud (API key)' };

export function migrateProviderLabels(s: Settings): Settings | undefined {
  if (!s.providers.some((p) => RENAMED_LABELS[p.label])) return undefined;
  return { ...s, providers: s.providers.map((p) => (RENAMED_LABELS[p.label] ? { ...p, label: RENAMED_LABELS[p.label] } : p)) };
}

/** A problem at start-up that the owner can fix (shown as a plain message, not a stack trace). */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupError';
  }
}

export class SettingsStore {
  readonly #path: string;
  #settings: Settings;

  constructor(dataDir: string) {
    this.#path = join(dataDir, FILE);
    let saved: Partial<Settings> = {};
    if (existsSync(this.#path)) {
      try {
        saved = JSON.parse(readFileSync(this.#path, 'utf8')) as Partial<Settings>;
      } catch (err) {
        throw new StartupError(`Her settings file ${this.#path} is damaged (${(err as Error).message}).`);
      }
    }
    this.#settings = { providers: [], ...saved };
  }

  get(): Settings {
    return structuredClone(this.#settings);
  }

  update(patch: Partial<Settings>): Settings {
    // Saved first: if the disk refuses, the running server keeps what is really on disk.
    const next = { ...this.#settings, ...patch };
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    renameSync(tmp, this.#path);
    this.#settings = next;
    return this.get();
  }
}

/** Adult mode is on only after the owner turned it on (with the 18+ confirmation). */
export const adultModeOn = (s: Settings): boolean => s.adultMode?.on === true && Boolean(s.adultMode.confirmedAt);
