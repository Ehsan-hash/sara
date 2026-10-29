#!/usr/bin/env node
// Phase 57: the stdio bridge to Sara's MCP server (the code is in src/mcp-bridge.ts, which the
// server also hands out as one standalone file under Settings → Connections → Other apps).
//   SARA_API_KEY=<key> node clients/mcp/sara-mcp.ts --server https://<her address>
//   node clients/mcp/sara-mcp.ts --server <name>   (a server saved by sara-chat, with its sign-in)
export { chatProfile, describeAnswer, DESCRIBE_TOOLS, parseArgs, sseMessages, startBridge } from '../../src/mcp-bridge.ts';
