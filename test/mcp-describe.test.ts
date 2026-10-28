// The stdio bridge's --describe mode (for MCP directories such as Glama that check a server by
// starting it with no setup): answers locally with exactly the tools Sara's server lists.
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { DESCRIBE_TOOLS, describeAnswer, parseArgs, startBridge } from '../src/mcp-bridge.ts';
import { describeTools } from '../src/mcp-server.ts';

test('--describe lists exactly the tools her server has (kept in sync)', () => {
  assert.deepEqual(DESCRIBE_TOOLS, describeTools());
});

test('--describe needs no server or key, and never contacts anything', async () => {
  assert.deepEqual(parseArgs(['--describe'], {}), { server: '', key: '', describe: true });
  const input = new PassThrough();
  const output = new PassThrough();
  let fetched = 0;
  const done = startBridge(parseArgs(['--describe'], {}), input, output, (async () => {
    fetched++;
    throw new Error('no network in describe mode');
  }) as typeof fetch);
  const lines: string[] = [];
  output.on('data', (b: Buffer) => lines.push(...b.toString().split('\n').filter(Boolean)));
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n');
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  input.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ask_sara","arguments":{"message":"hi"}}}\n');
  input.write('{"jsonrpc":"2.0","id":4,"method":"nope"}\n');
  input.end();
  await done;
  const out = lines.map((l) => JSON.parse(l));
  assert.equal(out.length, 4, 'the notification gets no answer');
  assert.equal(out[0].result.protocolVersion, '2025-06-18');
  assert.equal(out[1].result.tools.length, DESCRIBE_TOOLS.length);
  assert.equal(out[2].result.isError, true);
  assert.match(out[2].result.content[0].text, /no Sara server behind it/);
  assert.equal(out[3].error.code, -32601);
  assert.equal(fetched, 0);
});

test('--describe answers an unknown protocol version with its newest', () => {
  const a = describeAnswer({ id: 7, method: 'initialize', params: { protocolVersion: '1999-01-01' } }) as { result: { protocolVersion: string } };
  assert.equal(a.result.protocolVersion, '2025-11-25');
});
