import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/cli/args.js';

const spec = {
  options: {
    file: { type: 'string' },
    tag: { type: 'string', short: 't', multiple: true },
    quiet: { type: 'boolean', short: 'q' },
    verbose: { type: 'boolean', short: 'v' },
    min: { type: 'string' },
    format: { type: 'string', short: 'f', default: 'table' },
  },
};

test('long options, values and positionals', () => {
  assert.deepEqual(parseArgs(['add', '--file', 'x.json', 'coffee'], spec), { values: { file: 'x.json', format: 'table' }, positionals: ['add', 'coffee'] });
});

test('short options and groups', () => {
  assert.deepEqual(parseArgs(['-qv', '-t', 'a', '-tb'], spec).values, { quiet: true, verbose: true, tag: ['a', 'b'], format: 'table' });
});

test('--no- turns a switch off; -- ends options', () => {
  assert.equal(parseArgs(['--no-quiet'], spec).values.quiet, false);
  assert.deepEqual(parseArgs(['--', '--file', '-q'], spec).positionals, ['--file', '-q']);
});

test('unknown options and missing values are errors', () => {
  assert.throws(() => parseArgs(['--nope'], spec), /unknown option --nope/);
  assert.throws(() => parseArgs(['-x'], spec), /unknown option -x/);
  assert.throws(() => parseArgs(['--file'], spec), /needs a value/);
});

test('#12: a negative number is a value', () => {
  assert.deepEqual(parseArgs(['-12.50', 'Coffee'], spec).positionals, ['-12.50', 'Coffee']);
});
