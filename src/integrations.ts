// Glue between settings/vault and optional integrations (web search, MCP servers).
import type { SettingsStore } from './settings.ts';
import { mcpVaultKey, type McpSecrets } from './tools/mcp.ts';
import { searchVaultKey, type SearchConfig } from './tools/search.ts';
import type { Vault } from './vault.ts';

export function searchConfig(settings: SettingsStore, vault: Vault): SearchConfig | undefined {
  const s = settings.get().search;
  if (!s) return undefined;
  const apiKey = vault.get(searchVaultKey(s.provider));
  if (s.provider === 'searxng') return s.url ? { provider: s.provider, url: s.url } : undefined;
  return apiKey ? { provider: s.provider, apiKey } : undefined;
}

export function mcpSecrets(vault: Vault, name: string): McpSecrets {
  const raw = vault.get(mcpVaultKey(name));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as McpSecrets;
  } catch {
    return {};
  }
}

/** Merges submitted secret maps into the stored ones; empty values delete a key. */
export function mergeSecrets(current: Record<string, string> | undefined, patch: unknown): Record<string, string> {
  const out = { ...current };
  if (!patch || typeof patch !== 'object') return out;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(k)) throw new Error(`Invalid name: ${k}`);
    if (v === '' || v === null || v === undefined) delete out[k];
    else out[k] = String(v);
  }
  return out;
}
