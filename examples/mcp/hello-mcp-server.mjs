#!/usr/bin/env node
// Example MCP server (stdio), written with nothing but Node built-ins. Sara's MCP client starts it,
// lists its tools and registers each one as `mcp_<server>_<tool>` (here: mcp_hello_greet and
// mcp_hello_count_words). Add it in Settings → Abilities → Other programs (MCP):
//   name: hello · transport: stdio · command: node · arguments: /path/to/examples/mcp/hello-mcp-server.mjs
// Messages are JSON-RPC 2.0, one JSON object per line. Anything else this process prints to
// stdout must not look like JSON-RPC; log to stderr instead. See docs/EXTENDING.md.
import { createInterface } from 'node:readline';

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

const TOOLS = [
  {
    name: 'greet',
    description: 'Say hello to someone by name.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    // Read-only tools run without asking in Sara; anything else asks the owner first.
    annotations: { readOnlyHint: true },
  },
  {
    name: 'count_words',
    description: 'Count the words in a piece of text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true },
  },
];

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // a notification (e.g. notifications/initialized): no answer
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hello', version: '1.0.0' } });
    case 'tools/list':
      return reply(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const args = msg.params?.arguments ?? {};
      if (msg.params?.name === 'greet') return reply(msg.id, text(`Hello, ${String(args.name ?? 'friend')}!`));
      if (msg.params?.name === 'count_words') return reply(msg.id, text(String(String(args.text ?? '').split(/\s+/).filter(Boolean).length)));
      return reply(msg.id, text(`No tool called ${msg.params?.name}`, true));
    }
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});
