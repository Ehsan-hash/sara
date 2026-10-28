import { AnthropicProvider } from './anthropic.ts';
import { OpenAICompatibleProvider } from './openai-compatible.ts';
import { ChatGptProvider } from './chatgpt.ts';
import { CliAgentProvider } from './cli-agent.ts';
import { SUBSCRIPTION_KINDS, type Provider, type ProviderConfig, type ProviderKind } from './types.ts';
import type { Subscriptions } from '../subscriptions/index.ts';

/**
 * Built-in provider templates. None of these carry credentials; the owner adds their own keys
 * through the setup UI and they are stored encrypted on the server.
 *
 * The last three use the owner's subscription (sign in under Settings → Subscriptions):
 * ChatGPT through OpenAI's documented Sign in with ChatGPT for open-source apps, Claude and Grok
 * through their official command-line programs.
 */
export const PROVIDER_PRESETS: readonly ProviderConfig[] = [
  { id: 'ollama-local', label: 'Ollama on the server', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', local: true, needsKey: false },
  { id: 'ollama-pc', label: 'Ollama on my computer', kind: 'openai-compatible', baseUrl: 'http://100.x.y.z:11434/v1', local: true, needsKey: false },
  { id: 'ollama-cloud', label: 'Ollama Cloud (API key)', kind: 'openai-compatible', baseUrl: 'https://ollama.com/v1', needsKey: true },
  { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', needsKey: true },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { id: 'chatgpt', label: 'ChatGPT (your plan)', kind: 'chatgpt', baseUrl: 'https://api.openai.com/v1', needsKey: false },
  { id: 'claude-sub', label: 'Claude (your subscription)', kind: 'claude-code', baseUrl: 'https://api.anthropic.com', defaultModel: 'sonnet', needsKey: false },
  { id: 'grok-sub', label: 'Grok (SuperGrok / X Premium+)', kind: 'grok-cli', baseUrl: 'https://cli-chat-proxy.grok.com', needsKey: false },
];

export function createProvider(config: ProviderConfig, apiKey?: string, subs?: Subscriptions): Provider {
  if (SUBSCRIPTION_KINDS.includes(config.kind) && !subs) throw new Error(`${config.label} needs the subscription service.`);
  switch (config.kind) {
    case 'chatgpt':
      return new ChatGptProvider(config, subs!.chatgpt);
    case 'claude-code':
      return new CliAgentProvider(config, subs!.agent('claude'));
    case 'grok-cli':
      return new CliAgentProvider(config, subs!.agent('grok'));
    case 'anthropic':
      return new AnthropicProvider(config, apiKey);
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config, apiKey);
    default: {
      const kind: never = config.kind;
      throw new Error(`Unknown provider kind: ${String(kind)}`);
    }
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function validateProviderConfig(input: unknown): ProviderConfig {
  if (!input || typeof input !== 'object') throw new Error('Provider must be an object');
  const o = input as Record<string, unknown>;
  const id = String(o.id ?? '');
  if (!ID_RE.test(id)) throw new Error('Provider id must be lowercase letters, digits and dashes');
  const kind = o.kind;
  const KINDS: ProviderKind[] = ['openai-compatible', 'anthropic', ...SUBSCRIPTION_KINDS];
  if (!KINDS.includes(kind as ProviderKind)) throw new Error(`Provider kind must be one of ${KINDS.join(', ')}`);
  const baseUrl = String(o.baseUrl ?? '');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Provider baseUrl must be a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Provider baseUrl must be http or https');
  return {
    id,
    kind: kind as ProviderKind,
    // Subscription providers always use their vendor's fixed endpoint.
    baseUrl: SUBSCRIPTION_KINDS.includes(kind as ProviderKind) ? (PROVIDER_PRESETS.find((p) => p.kind === kind)?.baseUrl ?? baseUrl) : baseUrl,
    label: String(o.label ?? id).slice(0, 80),
    ...(o.defaultModel ? { defaultModel: String(o.defaultModel).slice(0, 200) } : {}),
    local: Boolean(o.local),
    needsKey: Boolean(o.needsKey),
  };
}
