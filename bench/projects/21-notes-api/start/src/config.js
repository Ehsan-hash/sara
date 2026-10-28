// Defaults; createApp({ config }) can override any of them.
export const DEFAULTS = Object.freeze({
  tokenTtlSeconds: 15 * 60,
  refreshGraceSeconds: 5 * 60,
  rateLimitPerMinute: 120,
  bodyLimitBytes: 64 * 1024,
  logRequests: false,
});

export function loadConfig(overrides = {}) {
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in DEFAULTS)) throw new Error(`Unknown config key: ${k}`);
    if (typeof v !== typeof DEFAULTS[k]) throw new Error(`Config ${k} must be a ${typeof DEFAULTS[k]}`);
    out[k] = v;
  }
  return Object.freeze(out);
}
