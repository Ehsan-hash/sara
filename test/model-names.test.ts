// One Ollama Cloud name rule: model-names.ts and the egress gate's own copy (net-guard.ts) agree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOUD_MODEL_NAME, isCloudModelName } from '../src/model-names.ts';
import { CLOUD_MODEL, ollamaEgress } from '../src/net-guard.ts';

const TABLE: [string, boolean][] = [
  ['gpt-oss:120b-cloud', true],
  ['gpt-oss:20b-cloud', true],
  ['glm-5.2:cloud', true],
  ['beam:cloud', true],
  ['gemma4:31b-cloud', true],
  ['Kimi-K2:CLOUD', true],
  [' glm-5.2:cloud ', true],
  ['qwen3.5:9b', false],
  ['cloudy:7b', false],
  ['my-cloud-distill:8b', false],
  ['llama3:cloud.q4', false],
  ['soundcloud-bot:latest', false],
  ['cloud', false],
  ['', false],
];

test('model names: one Ollama Cloud rule; the egress gate copy gives the same answers', () => {
  assert.equal(CLOUD_MODEL.source, CLOUD_MODEL_NAME.source);
  assert.equal(CLOUD_MODEL.flags, CLOUD_MODEL_NAME.flags);
  for (const [name, cloud] of TABLE) {
    assert.equal(isCloudModelName(name), cloud, name);
    assert.equal(CLOUD_MODEL.test(name.trim()), cloud, `net-guard: ${name}`);
    const blocked = ollamaEgress(new URL('http://127.0.0.1:11434/api/chat'), JSON.stringify({ model: name, messages: [] }));
    assert.equal(Boolean(blocked), cloud && name.length > 0, `egress: ${name}`);
  }
});
