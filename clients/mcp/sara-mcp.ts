#!/usr/bin/env node
// Phase 57: the stdio bridge to Sara's MCP server (the code is in src/mcp-bridge.ts, which the
// server also hands out as one standalone file under Settings → Connections → Other apps).
//   SARA_API_KEY=<key> node clients/mcp/sara-mcp.ts --server https://<her address>
export { parseArgs, sseMessages, startBridge } from '../../src/mcp-bridge.ts';
