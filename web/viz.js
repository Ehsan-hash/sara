// 2.8 polish pass: small pictures of real data. Illustrated weather art for the Today tile and the
// weather card (from the WMO codes Open-Meteo sends, or wttr.in's symbol and words), a tiny sparkline
// of the next hours, and progress rings (jobs, the Planner's done-today, Getting started). Nothing here
// invents numbers: a ring without a known share is drawn as a moving arc, not as a percentage.
// Colours come from theme.css tokens through class names (polish.css), never from this file.

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// ---------- weather art ----------

/** The art for a weather kind (today.js weatherKind → kind) by day or night. */
export function artKind(kind, day = true) {
  switch (kind) {
    case 'clear': return day ? 'sun' : 'moon';
    case 'partly': return day ? 'partly-day' : 'partly-night';
    case 'cloudy': return 'cloud';
    case 'fog': return 'fog';
    case 'drizzle': case 'rain': return 'rain';
    case 'showers': return day ? 'showers-day' : 'rain';
    case 'snow': case 'snow-showers': return 'snow';
    case 'thunder': return 'storm';
    default: return 'cloud';
  }
}

/** A kind from wttr.in's symbol or its words (the weather card), else from words like "Light rain". */
export function kindFromSky(symbol = '', words = '') {
  const s = `${symbol} ${words}`;
  if (/⛈|🌩|thunder/iu.test(s)) return 'thunder';
  if (/🌨|❄|☃|snow|sleet|blizzard|ice/iu.test(s)) return 'snow';
  if (/🌦/u.test(s)) return 'showers';
  if (/🌧|☔|rain|drizzle|shower/iu.test(s)) return 'rain';
  if (/🌫|fog|mist|haze/iu.test(s)) return 'fog';
  if (/🌤|⛅|🌥|partly/iu.test(s)) return 'partly';
  if (/☁|cloud|overcast/iu.test(s)) return 'cloudy';
  if (/☀|🌞|clear|sunny|fair/iu.test(s)) return 'clear';
  if (/🌙|🌑|🌕/u.test(s)) return 'clear';
  return 'unknown';
}

const CLOUD = 'M19 46a8 8 0 0 1-1.2-15.9A12 12 0 0 1 41 26.5a9.5 9.5 0 1 1 5 19.5z';

function cloud(g, ids, { dx = 0, dy = 0, scale = 1, back = false } = {}) {
  const p = svgEl('path', { d: CLOUD, class: back ? 'wa-cloud wa-cloud-back' : 'wa-cloud', fill: `url(#${back ? ids.back : ids.cloud})` });
  if (dx || dy || scale !== 1) p.setAttribute('transform', `translate(${dx} ${dy}) scale(${scale})`);
  g.append(p);
}

function sun(g, ids, cx = 32, cy = 32, r = 11) {
  g.append(svgEl('circle', { cx, cy, r: r * 1.9, class: 'wa-sun-glow', fill: `url(#${ids.glow})` }));
  const rays = svgEl('g', { class: 'wa-rays' });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const r1 = r + 4;
    const r2 = r + 8;
    rays.append(svgEl('line', { x1: (cx + r1 * Math.cos(a)).toFixed(1), y1: (cy + r1 * Math.sin(a)).toFixed(1), x2: (cx + r2 * Math.cos(a)).toFixed(1), y2: (cy + r2 * Math.sin(a)).toFixed(1) }));
  }
  g.append(rays, svgEl('circle', { cx, cy, r, class: 'wa-sun', fill: `url(#${ids.sun})` }));
}

function moon(g, ids, cx = 32, cy = 30, r = 13) {
  g.append(svgEl('circle', { cx, cy, r: r * 1.8, class: 'wa-moon-glow', fill: `url(#${ids.glow})` }));
  // A crescent: the full disc with a disc moved up and to the right masked out of it.
  const mask = svgEl('mask', { id: ids.mask });
  mask.append(svgEl('rect', { x: 0, y: 0, width: 64, height: 64, fill: 'white' }), svgEl('circle', { cx: cx + r * 0.62, cy: cy - r * 0.42, r: r * 0.86, fill: 'black' }));
  g.append(mask, svgEl('circle', { cx, cy, r, class: 'wa-moon', fill: `url(#${ids.moon})`, mask: `url(#${ids.mask})` }));
}

function stars(g, list) {
  for (const [x, y, s] of list) g.append(svgEl('path', { class: 'wa-star', d: `M${x} ${y - s}L${x + s * 0.3} ${y - s * 0.3}L${x + s} ${y}L${x + s * 0.3} ${y + s * 0.3}L${x} ${y + s}L${x - s * 0.3} ${y + s * 0.3}L${x - s} ${y}L${x - s * 0.3} ${y - s * 0.3}z` }));
}

function drops(g, n, cls = 'wa-drop') {
  const xs = n === 2 ? [27, 37] : [23, 32, 41];
  for (const [i, x] of xs.entries()) g.append(svgEl('line', { class: cls, x1: x, y1: 50 + (i % 2) * 2, x2: x - 3, y2: 57 + (i % 2) * 2 }));
}

/**
 * Illustrated weather: an <svg class="wx-art wx-<art>"> (decorative: the words beside it say the
 * weather). `kind` is today.js's weather kind ('clear', 'partly', 'rain'…).
 */
export function weatherArt(kind, day = true, cls = '') {
  const art = artKind(kind, day);
  const n = ++uid;
  const ids = { sun: `wa-s${n}`, glow: `wa-g${n}`, cloud: `wa-c${n}`, back: `wa-b${n}`, moon: `wa-m${n}`, mask: `wa-k${n}` };
  const s = svgEl('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false', class: `wx-art wx-${art}${cls ? ` ${cls}` : ''}` });
  const defs = svgEl('defs');
  const grad = (id, cls1, cls2, radial = false) => {
    const gr = svgEl(radial ? 'radialGradient' : 'linearGradient', radial ? { id } : { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    gr.append(svgEl('stop', { offset: 0, class: cls1 }), svgEl('stop', { offset: 1, class: cls2 }));
    defs.append(gr);
  };
  grad(ids.sun, 'wa-stop-sun-a', 'wa-stop-sun-b');
  grad(ids.glow, 'wa-stop-glow-a', 'wa-stop-glow-b', true);
  grad(ids.cloud, 'wa-stop-cloud-a', 'wa-stop-cloud-b');
  grad(ids.back, 'wa-stop-back-a', 'wa-stop-back-b');
  grad(ids.moon, 'wa-stop-moon-a', 'wa-stop-moon-b');
  s.append(defs);
  const g = svgEl('g');
  s.append(g);
  switch (art) {
    case 'sun': sun(g, ids); break;
    case 'moon': moon(g, ids, 32, 32, 14); stars(g, [[12, 16, 2.2], [50, 46, 1.8], [52, 14, 1.4]]); break;
    case 'partly-day': sun(g, ids, 24, 24, 9); cloud(g, ids, { dx: 4, dy: 6 }); break;
    case 'partly-night': moon(g, ids, 25, 22, 10); stars(g, [[50, 12, 1.6]]); cloud(g, ids, { dx: 4, dy: 6 }); break;
    case 'cloud': cloud(g, ids, { dx: 10, dy: -6, scale: 0.8, back: true }); cloud(g, ids, { dx: 0, dy: 2 }); break;
    case 'rain': cloud(g, ids, { dy: -6 }); drops(g, 3); break;
    case 'showers-day': sun(g, ids, 22, 20, 8); cloud(g, ids, { dx: 4, dy: -2 }); drops(g, 2); break;
    case 'snow': {
      cloud(g, ids, { dy: -6 });
      for (const [x, y] of [[23, 52], [32, 57], [41, 52]]) g.append(svgEl('path', { class: 'wa-flake', d: `M${x - 3} ${y}h6M${x} ${y - 3}v6M${x - 2.1} ${y - 2.1}l4.2 4.2M${x + 2.1} ${y - 2.1}l-4.2 4.2` }));
      break;
    }
    case 'storm': cloud(g, ids, { dy: -6 }); g.append(svgEl('path', { class: 'wa-bolt', d: 'M33 40l-7 11h6l-3 9 9-13h-6l3-7z' })); break;
    case 'fog': cloud(g, ids, { dy: -10, back: true }); for (const [y, x1, x2] of [[42, 14, 50], [49, 18, 46], [56, 22, 42]]) g.append(svgEl('line', { class: 'wa-fog', x1, y1: y, x2, y2: y })); break;
    default: cloud(g, ids);
  }
  return s;
}

// ---------- sparkline ----------

/** The points of a sparkline for numbers (nulls skipped), scaled into w x h with a little padding. */
export function sparkPoints(values, w = 100, h = 24, pad = 3) {
  const list = (Array.isArray(values) ? values : []).map((v, i) => [i, typeof v === 'number' && Number.isFinite(v) ? v : null]).filter(([, v]) => v !== null);
  if (list.length < 2) return [];
  const n = values.length - 1;
  const vs = list.map(([, v]) => v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  return list.map(([i, v]) => [+(pad + (i / n) * (w - 2 * pad)).toFixed(1), +(hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - 2 * pad)).toFixed(1)]);
}

/** A tiny line of numbers (the next hours' temperatures): decorative, the numbers are shown as text. */
export function sparkline(values, { w = 100, h = 24, cls = '' } = {}) {
  const pts = sparkPoints(values, w, h);
  if (!pts.length) return null;
  const n = ++uid;
  const s = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false', class: `spark${cls ? ` ${cls}` : ''}` });
  const defs = svgEl('defs');
  const gr = svgEl('linearGradient', { id: `sp${n}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  gr.append(svgEl('stop', { offset: 0, class: 'spark-stop-a' }), svgEl('stop', { offset: 1, class: 'spark-stop-b' }));
  defs.append(gr);
  const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
  s.append(
    defs,
    svgEl('polygon', { class: 'spark-area', fill: `url(#sp${n})`, points: `${pts[0][0]},${h} ${line} ${pts.at(-1)[0]},${h}` }),
    svgEl('polyline', { class: 'spark-line', points: line, 'vector-effect': 'non-scaling-stroke' }),
  );
  return s;
}

// ---------- rings ----------

/** A share for a ring: done / total between 0 and 1, or null when there is nothing to count. */
export function share(done, total) {
  const d = Number(done);
  const t = Number(total);
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.min(1, d / t));
}

/**
 * A progress ring. `value` 0..1 fills that much of it; null draws a moving arc ("working, no
 * percentage known"). `label` names it for screen readers (role img); without one it is decorative.
 */
export function ring(value, { size = 36, stroke = 3.5, label = '', text = '', cls = '' } = {}) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const wrap = document.createElement('span');
  wrap.className = `pring${known ? '' : ' pring-moving'}${cls ? ` ${cls}` : ''}`;
  wrap.style.setProperty('--pring-size', `${size}px`);
  if (label) {
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', label);
  } else wrap.setAttribute('aria-hidden', 'true');
  const r = (size - stroke) / 2;
  const s = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', focusable: 'false' });
  const n = ++uid;
  const defs = svgEl('defs');
  const gr = svgEl('linearGradient', { id: `rg${n}`, x1: 0, y1: 0, x2: 1, y2: 1 });
  gr.append(svgEl('stop', { offset: 0, class: 'pring-stop-a' }), svgEl('stop', { offset: 1, class: 'pring-stop-b' }));
  defs.append(gr);
  const c = size / 2;
  const track = svgEl('circle', { cx: c, cy: c, r, class: 'pring-track', 'stroke-width': stroke });
  const arc = svgEl('circle', { cx: c, cy: c, r, class: 'pring-arc', stroke: `url(#rg${n})`, 'stroke-width': stroke, pathLength: 100, transform: `rotate(-90 ${c} ${c})` });
  arc.setAttribute('stroke-dasharray', known ? `${(value * 100).toFixed(1)} 100` : '28 100');
  s.append(defs, track, arc);
  wrap.append(s);
  if (text) {
    const tx = document.createElement('span');
    tx.className = 'pring-text';
    tx.textContent = text;
    wrap.append(tx);
  }
  return wrap;
}
