// MCP stdio server that Claude Code / Grok CLI start when Sara drives them. It exposes Sara's
// tools and forwards every call to the Sara turn that started the CLI (127.0.0.1, per-turn
// token), so approvals, the sandbox, snapshots and receipts work exactly as for other models.
// Run: node src/agent-bridge.ts  (env SARA_BRIDGE_URL, SARA_BRIDGE_TOKEN)
import { netFetch } from './net-guard.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Where to call back: from the environment, or (Grok, which may not pass its environment on) from
// .sara-bridge.json in the working folder of this turn.
function connection(): { url: string; token: string } {
  if (process.env.SARA_BRIDGE_URL) return { url: process.env.SARA_BRIDGE_URL, token: process.env.SARA_BRIDGE_TOKEN ?? '' };
  try {
    const c = JSON.parse(readFileSync(join(process.cwd(), '.sara-bridge.json'), 'utf8')) as { url?: string; token?: string };
    return { url: String(c.url ?? ''), token: String(c.token ?? '') };
  } catch {
    return { url: '', token: '' };
  }
}
const { url, token } = connection();

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function bridge(path: string, body?: unknown): Promise<unknown> {
  const res = await netFetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`Sara bridge HTTP ${res.status}`);
  return res.json();
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let req: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.id === undefined) return; // notifications
  void (async () => {
    try {
      switch (req.method) {
        case 'initialize':
          return send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: req.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sara', version: '1' } } });
        case 'ping':
          return send({ jsonrpc: '2.0', id: req.id, result: {} });
        case 'tools/list':
          return send({ jsonrpc: '2.0', id: req.id, result: { tools: url ? await bridge('/tools') : [] } });
        case 'tools/call': {
          const r = (await bridge('/call', { name: req.params?.name, arguments: req.params?.arguments ?? {} })) as { text: string; isError?: boolean };
          return send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: r.text }], isError: Boolean(r.isError) } });
        }
        default:
          return send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Unknown method ${req.method}` } });
      }
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: (err as Error).message } });
    }
  })();
});
