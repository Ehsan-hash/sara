// Tool registry, permissions and approvals.
import { randomUUID } from 'node:crypto';
import { BUILTIN_TOOLS } from './builtin.ts';
import type { Permission, Tool } from './types.ts';

export class ToolRegistry {
  readonly #tools = new Map<string, Tool>();

  constructor(tools: readonly Tool[] = BUILTIN_TOOLS) {
    for (const t of tools) this.add(t);
  }

  add(tool: Tool): void {
    this.#tools.set(tool.spec.name, tool);
  }

  remove(name: string): void {
    this.#tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name);
  }

  list(): Tool[] {
    return [...this.#tools.values()];
  }

  #unsandboxed = false;
  /**
   * Phase 46: commands run without a sandbox (Windows, or none found). Tools that run commands
   * then ask the owner first by default; an explicit choice in Settings still wins.
   */
  get unsandboxed(): boolean {
    return this.#unsandboxed;
  }
  set unsandboxed(v: boolean) {
    this.#unsandboxed = v;
  }

  /** The permission a tool has when the owner hasn't chosen one. */
  defaultFor(tool: Tool | undefined): Permission {
    if (!tool) return 'never';
    if (tool.runsCommands && this.unsandboxed && tool.defaultPermission === 'auto') return 'ask';
    return tool.defaultPermission;
  }

  permission(name: string, overrides: Record<string, Permission> | undefined): Permission {
    return overrides?.[name] ?? this.defaultFor(this.#tools.get(name));
  }

  /** Tools the model may see (anything not set to "never"). */
  enabled(overrides: Record<string, Permission> | undefined): Tool[] {
    return this.list().filter((t) => (t.isAvailable?.() ?? true) && this.permission(t.spec.name, overrides) !== 'never');
  }
}

interface Pending {
  conversationId: string;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

/** Holds tool calls waiting for the owner's approve/deny click. */
export class ApprovalBroker {
  readonly #pending = new Map<string, Pending>();
  readonly #timeoutMs: number;

  constructor(timeoutMs = 10 * 60 * 1000) {
    this.#timeoutMs = timeoutMs;
  }

  request(conversationId: string, signal: AbortSignal): { id: string; decision: Promise<boolean> } {
    const id = randomUUID();
    const decision = new Promise<boolean>((resolve) => {
      const done = (v: boolean) => {
        const p = this.#pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.#pending.delete(id);
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      };
      const onAbort = () => done(false);
      signal.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, { conversationId, resolve: done, timer: setTimeout(() => done(false), this.#timeoutMs) });
    });
    return { id, decision };
  }

  decide(id: string, approved: boolean): boolean {
    const p = this.#pending.get(id);
    if (!p) return false;
    p.resolve(approved);
    return true;
  }

  pendingFor(conversationId: string): string[] {
    return [...this.#pending.entries()].filter(([, p]) => p.conversationId === conversationId).map(([id]) => id);
  }
}
