# For MCP directories (Glama) that check a server by starting it: runs Sara's stdio MCP bridge in
# --describe mode, which answers initialize and tools/list with her real tools and needs no server.
# To actually use Sara over MCP, run your own Sara and the bridge with --server (docs/OTHER_APPS.md).
FROM node:24-slim
WORKDIR /app
COPY src/mcp-bridge.ts /app/sara-mcp.ts
USER node
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "/app/sara-mcp.ts", "--describe"]
