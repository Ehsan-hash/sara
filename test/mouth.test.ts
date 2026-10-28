// Phase 63: the talking portrait's mouth shapes (web/mouth.js): features, choice, smoothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain JS module shared with the browser
import { CALM_SHAPES, MouthShaper, pickShape, SHAPES, soundFeatures } from '../web/mouth.js';

type Features = { level: number; centroid: number; low: number; high: number };
const f = (level: number, centroid = 1400, low = 0.3, high = 0.05): Features => ({ level, centroid, low, high });

/** Analyser-like bytes: a sine of `amp` (0..1) in time; a spectrum with energy in [fromHz, toHz). */
function sound(amp: number, fromHz: number, toHz: number, binHz = 93.75, bins = 256) {
  const time = Uint8Array.from({ length: 512 }, (_, i) => Math.round(128 + 127 * amp * Math.sin(i / 3)));
  const freq = Uint8Array.from({ length: bins }, (_, i) => (i * binHz >= fromHz && i * binHz < toHz ? 220 : 0));
  return soundFeatures(time, freq, binHz) as Features;
}

test('features: loudness, brightness and where the energy sits', () => {
  const quiet = soundFeatures(new Uint8Array(512).fill(128), new Uint8Array(256), 93.75) as Features;
  assert.equal(quiet.level, 0);
  assert.equal(quiet.centroid, -1);
  const hiss = sound(0.3, 4500, 8000);
  assert.ok(hiss.high > 0.8, `high ${hiss.high}`);
  const hum = sound(0.3, 100, 450);
  assert.ok(hum.low > 0.8, `low ${hum.low}`);
  const oo = sound(0.3, 300, 900);
  assert.ok(oo.centroid > 0 && oo.centroid < 1000, `centroid ${oo.centroid}`);
  const ee = sound(0.3, 2000, 3500);
  assert.ok(ee.centroid > 1550, `centroid ${ee.centroid}`);
});

test('shape choice: silence, closures, hiss, vowels', () => {
  assert.equal(pickShape(f(0.01)), 'rest');
  assert.equal(pickShape(f(0.05), 0.2), 'mbp', 'a sharp dip mid-speech is the lips closing (m/b/p)');
  assert.equal(pickShape(f(0.06, 400, 0.7, 0.01)), 'mbp', 'a quiet hum (m, n)');
  assert.equal(pickShape(f(0.1, 3000, 0.1, 0.6)), 'teeth', 's / z / sh');
  assert.equal(pickShape(f(0.08, 2500, 0.2, 0.3)), 'fv', 'f / v');
  assert.equal(pickShape(f(0.12, 800)), 'round', 'oo / o');
  assert.equal(pickShape(f(0.12, 2100)), 'ee', 'ee / i');
  assert.equal(pickShape(f(0.05, 1400)), 'half', 'quiet vowel');
  assert.equal(pickShape(f(0.12, 1400)), 'open', 'ah');
  assert.equal(pickShape(f(0.25, 1400)), 'wide', 'loud aa');
  // Every real sound picks one of the known shapes.
  for (const s of [sound(0.3, 4500, 8000), sound(0.3, 100, 450), sound(0.05, 300, 3000), sound(0.6, 600, 2400)]) assert.ok(SHAPES.includes(pickShape(s)));
});

/** Runs the shaper over a sequence at 60 frames a second; returns the shape after each frame. */
function run(shaper: InstanceType<typeof MouthShaper>, seq: Features[]): string[] {
  return seq.map((x) => {
    shaper.update(x, 1 / 60);
    return shaper.shape as string;
  });
}

test('smoothing: a sound that changes every frame does not make the mouth flicker', () => {
  const s = new MouthShaper();
  run(s, Array(10).fill(f(0.12, 1400)));
  assert.equal(s.shape, 'open');
  // Alternating "oo" / "ee" requests every frame: neither is asked long enough to take over.
  const shapes = run(s, Array.from({ length: 30 }, (_, i) => (i % 2 ? f(0.12, 800) : f(0.12, 2100))));
  assert.ok(shapes.every((x) => x === 'open'), shapes.join(','));
  // A steady "ee" takes over within a few frames.
  const after = run(s, Array(6).fill(f(0.12, 2100)));
  assert.equal(after.at(-1), 'ee');
  // Weights blend: right after a change the old shape is still partly shown, and they add up to ~1.
  const w = s.weights as Record<string, number>;
  assert.ok(w.ee > 0 && w.ee < 1 && w.open > 0, JSON.stringify(w));
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-6);
});

test('smoothing: lips snap shut quickly for m/b/p, and each shape is held a moment', () => {
  const s = new MouthShaper();
  run(s, Array(12).fill(f(0.2, 1400)));
  assert.equal(s.shape, 'wide');
  const shapes = run(s, [f(0.05), f(0.05), f(0.05), f(0.05)]);
  assert.ok(shapes.slice(0, 3).includes('mbp'), `closes within 3 frames: ${shapes.join(',')}`);
  // One stray frame of hiss inside a vowel changes nothing.
  run(s, Array(10).fill(f(0.12, 1400)));
  const one = run(s, [f(0.1, 3000, 0.1, 0.6), f(0.12, 1400), f(0.12, 1400)]);
  assert.ok(!one.includes('teeth'), one.join(','));
});

test('reduced motion: only closed / half / open, and slower', () => {
  const s = new MouthShaper({ calm: true });
  const seen = new Set(run(s, [...Array(20).fill(f(0.12, 800)), ...Array(20).fill(f(0.1, 3000, 0.1, 0.6)), ...Array(20).fill(f(0.01))]));
  for (const x of seen) assert.ok(CALM_SHAPES.includes(x), x);
  const fast = new MouthShaper();
  const calm = new MouthShaper({ calm: true });
  const steps = (m: InstanceType<typeof MouthShaper>) => run(m, Array(30).fill(f(0.12, 1400))).indexOf('open');
  assert.ok(steps(calm) > steps(fast), 'changes take longer with reduced motion');
});
