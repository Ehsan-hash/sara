// Phase 63: which mouth shape her portrait shows while her voice plays. Pure functions (no DOM), so
// the choice can be tested: features of the sound (loudness, where its energy sits in the
// spectrum) → a shape → smoothed weights per shape, held long enough that it never flickers.
//
// Thresholds were set from a recorded voice (levels 0.04–0.22, brightness 740–2400 Hz).
//
// Shapes (the portrait draws each from her existing frames, see web/presence.js):
//   rest   mouth closed (silence)               mbp    lips pressed (m, b, p: a sudden dip)
//   fv     lower lip to the teeth (f, v)        teeth  teeth together, lips apart (s, z, sh, t)
//   half   just parted (quiet sounds)           open   "ah"
//   wide   wide open (loud "aa")                round  rounded (o, oo, w)
//   ee     wide and smiling (ee, i, e)

export const SHAPES = ['rest', 'mbp', 'fv', 'teeth', 'half', 'open', 'wide', 'round', 'ee'];
/** With reduced motion: only closed / slightly open / open, changing slowly. */
export const CALM_SHAPES = ['rest', 'half', 'open'];

const SILENT = 0.03;

/**
 * Features of one moment of sound. `time` = analyser time-domain bytes (128 = silence), `freq` =
 * analyser frequency bytes (0–255 over the analyser's dB range), `binHz` = Hz per frequency bin.
 */
export function soundFeatures(time, freq, binHz) {
  let sum = 0;
  for (const v of time) sum += (v - 128) * (v - 128);
  const level = time.length ? Math.sqrt(sum / time.length) / 128 : 0;
  const out = { level, centroid: -1, low: 0, high: 0 };
  if (!freq || level <= SILENT || !binHz) return out;
  // On amplitudes (the bytes are decibels, which flatten the spectrum): brightness = the weighted
  // mean frequency between 250 Hz and 4 kHz; the share of energy below 500 Hz (hums: m, n) and
  // above 4 kHz (hiss: s, f).
  const amp = (v) => (v ? 10 ** ((v / 255) * 3.5) : 0); // a 70 dB range
  let w = 0;
  let m = 0;
  let lo = 0;
  let hi = 0;
  let all = 0;
  for (let i = 1; i < freq.length; i++) {
    const hz = i * binHz;
    if (hz >= 8000) break;
    const a = amp(freq[i]);
    if (hz >= 250 && hz < 4000) {
      w += a;
      m += a * hz;
    }
    if (hz >= 80) {
      all += a;
      if (hz < 500) lo += a;
      else if (hz >= 4000) hi += a;
    }
  }
  if (w > 0) out.centroid = m / w;
  if (all > 0) {
    out.low = lo / all;
    out.high = hi / all;
  }
  return out;
}

/**
 * The shape a moment of sound asks for. `recent` = the loudest level of the last ~150 ms: a sharp
 * dip below it while she's talking is the lips closing for m / b / p.
 */
export function pickShape(f, recent = 0) {
  if (f.level < SILENT) return 'rest';
  if (recent > 0.08 && f.level < recent * 0.35) return 'mbp';
  if (f.high > 0.42) return 'teeth';
  if (f.high > 0.25 && f.low < 0.35) return 'fv';
  if (f.low > 0.6 && f.level < 0.09) return 'mbp';
  if (f.centroid > 0 && f.centroid < 1000) return 'round';
  if (f.centroid > 1550) return 'ee';
  if (f.level < 0.07) return 'half';
  return f.level > 0.18 ? 'wide' : 'open';
}

const CALM = { rest: 'rest', mbp: 'rest', fv: 'half', teeth: 'half', half: 'half', open: 'open', wide: 'open', round: 'open', ee: 'open' };

/**
 * Turns the shape asked for each frame into steady weights: a new shape must be asked for a little
 * while (and the current one shown a little while) before it takes over; closing (rest, m/b/p) is
 * quicker, because lips really do snap shut. Weights ease toward the shape, so changes blend.
 */
export class MouthShaper {
  constructor({ calm = false } = {}) {
    this.calm = calm;
    this.shape = 'rest';
    this.weights = Object.fromEntries(SHAPES.map((s) => [s, s === 'rest' ? 1 : 0]));
    this.recent = 0;
    this.held = 1;
    this.pending = null;
    this.pendingFor = 0;
  }

  /** One animation frame: features of the sound, seconds since the last frame. Returns the weights. */
  update(f, dt) {
    dt = Math.max(0, Math.min(0.1, dt));
    let want = pickShape(f, this.recent);
    // The recent peak falls ~4× a second, so a dip is measured against the last syllable only.
    this.recent = Math.max(f.level, this.recent * Math.exp(-dt * 6));
    if (this.calm) want = CALM[want];
    this.held += dt;
    const closing = want === 'rest' || want === 'mbp';
    const needAsked = this.calm ? 0.15 : closing ? 0.02 : 0.05;
    const needHeld = this.calm ? 0.2 : closing ? 0.04 : 0.07;
    if (want === this.shape) {
      this.pending = null;
      this.pendingFor = 0;
    } else {
      if (want !== this.pending) {
        this.pending = want;
        this.pendingFor = 0;
      }
      this.pendingFor += dt;
      if (this.pendingFor >= needAsked && this.held >= needHeld) {
        this.shape = want;
        this.held = 0;
        this.pending = null;
        this.pendingFor = 0;
      }
    }
    const k = Math.min(1, dt * (this.calm ? 8 : this.shape === 'mbp' ? 30 : 18));
    for (const s of SHAPES) this.weights[s] += ((s === this.shape ? 1 : 0) - this.weights[s]) * k;
    return this.weights;
  }
}
