import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/cli/args.js';

const spec = {
  options: {
    since: { type: 'string' },
    min: { type: 'string' },
    tag: { type: 'string', short: 't', multiple: true },
    quiet: { type: 'boolean', short: 'q' },
    verbose: { type: 'boolean', short: 'v' },
    date: { type: 'string', short: 'd' },
  },
};

test('hidden: --name=value for every kind of option', () => {
  assert.deepEqual(parseArgs(['--since=2026-01-01', '--tag=a', '--tag=b=c', '--min=-100'], spec).values, { since: '2026-01-01', tag: ['a', 'b=c'], min: '-100' });
  assert.deepEqual(parseArgs(['--since=', 'x'], spec).values, { since: '' }, 'an empty value is a value');
  assert.throws(() => parseArgs(['--nope=1'], spec), /unknown option --nope/);
});

test('hidden: negative numbers are values and arguments', () => {
  for (const n of ['-12.50', '-5', '-0.75', '-1,000.00']) {
    assert.deepEqual(parseArgs([n, 'Coffee'], spec).positionals, [n, 'Coffee'], n);
    assert.equal(parseArgs(['--min', n], spec).values.min, n, n);
  }
  assert.deepEqual(parseArgs(['-d', '-7d'], spec).values, { date: '-7d' }, 'a short option still takes the next argument');
});

test('hidden: the rest of the rules still hold', () => {
  assert.deepEqual(parseArgs(['-qv', '-tx', '-t', 'y'], spec).values, { quiet: true, verbose: true, tag: ['x', 'y'] });
  assert.deepEqual(parseArgs(['--', '-12', '--since=x'], spec).positionals, ['-12', '--since=x']);
  assert.equal(parseArgs(['--no-quiet'], spec).values.quiet, false);
  assert.throws(() => parseArgs(['-x'], spec), /unknown option -x/);
  assert.throws(() => parseArgs(['-q1'], spec), /unknown option -1/, 'a digit inside a switch group is not a number');
  assert.throws(() => parseArgs(['--since'], spec), /needs a value/);
});
