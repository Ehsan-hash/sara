// Minimal stdio MCP server for tests: tools "echo" and "fail"; reports the SECRET_TOKEN env var.
import { createInterface } from 'node:readline';

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
console.log('not json: servers sometimes log to stdout');

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  switch (msg.method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } });
    case 'tools/list':
      if (!msg.params?.cursor) {
        return send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { tools: [{ name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }], nextCursor: 'p2' },
        });
      }
      return send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } }] } });
    case 'tools/call':
      if (msg.params.name === 'echo') {
        return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo: ${msg.params.arguments.text} token=${process.env.SECRET_TOKEN ?? ''}` }, { type: 'image', mimeType: 'image/png', data: 'x' }] } });
      }
      return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'it broke' }], isError: true } });
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});
