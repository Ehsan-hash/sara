// Phase 36: her picture, large. Zoom with the wheel, a pinch or a double tap; drag to look around
// when zoomed; swipe or use the arrows to go through her expressions, outfits and saved looks;
// save or share the picture. Works the same in a browser, the phone apps and the desktop apps.
import { t } from './naming.js';

const box = document.createElement('dialog');
box.id = 'lightbox';
box.className = 'lightbox';
box.setAttribute('aria-label', t('Picture'));
// Its own close button and gestures: the app's usual window wiring (✕, Save) stays out.
box.dataset.wired = '1';
box.innerHTML = `
  <div class="lb-stage"><img class="lb-img" alt="" draggable="false"></div>
  <div class="lb-top">
    <span class="lb-label"></span>
    <span class="lb-count muted"></span>
    <span class="lb-actions">
      <a class="lb-save" download title="Save the picture" aria-label="Save the picture">⤓</a>
      <button type="button" class="lb-share" title="Share" aria-label="Share" hidden>⇪</button>
      <button type="button" class="lb-close" title="Close" aria-label="Close">✕</button>
    </span>
  </div>
  <button type="button" class="lb-prev" aria-label="Previous">‹</button>
  <button type="button" class="lb-next" aria-label="Next">›</button>
  <div class="lb-dots" role="tablist"></div>`;
document.body.append(box);
const $ = (s) => box.querySelector(s);
const img = $('.lb-img');
const stage = $('.lb-stage');

let items = [];
let index = 0;
const view = { scale: 1, x: 0, y: 0 };

function apply() {
  img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  box.classList.toggle('zoomed', view.scale > 1.01);
}
function reset() {
  view.scale = 1;
  view.x = 0;
  view.y = 0;
  apply();
}
/** Keeps the picture from being dragged out of view. */
function clamp() {
  const r = stage.getBoundingClientRect();
  const mx = (r.width * (view.scale - 1)) / 2;
  const my = (r.height * (view.scale - 1)) / 2;
  view.x = Math.max(-mx, Math.min(mx, view.x));
  view.y = Math.max(-my, Math.min(my, view.y));
}
/** Zooms by `k` around a point on screen (cx, cy). */
function zoomAt(k, cx, cy) {
  const r = stage.getBoundingClientRect();
  const next = Math.max(1, Math.min(6, view.scale * k));
  const f = next / view.scale;
  const ox = cx - (r.left + r.width / 2);
  const oy = cy - (r.top + r.height / 2);
  view.x = ox - (ox - view.x) * f;
  view.y = oy - (oy - view.y) * f;
  view.scale = next;
  if (next === 1) {
    view.x = 0;
    view.y = 0;
  }
  clamp();
  apply();
}

function show(i) {
  if (!items.length) return;
  index = (i + items.length) % items.length;
  const it = items[index];
  reset();
  img.src = it.src;
  img.alt = it.label ?? '';
  $('.lb-label').textContent = it.label ?? '';
  $('.lb-count').textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
  $('.lb-save').href = it.src;
  $('.lb-save').download = `${(it.label || 'picture').replace(/[^\w -]+/g, '').trim() || 'picture'}.jpg`;
  $('.lb-prev').hidden = $('.lb-next').hidden = items.length < 2;
  $('.lb-dots').replaceChildren(
    ...(items.length > 1 && items.length <= 24
      ? items.map((x, n) => {
          const d = document.createElement('button');
          d.type = 'button';
          d.className = n === index ? 'on' : '';
          d.setAttribute('aria-label', x.label ?? t('Picture {x}', { x: n + 1 }));
          d.addEventListener('click', () => show(n));
          return d;
        })
      : []),
  );
}

/** Opens the viewer on a list of pictures ({ src, label }), starting at `start`. */
export function openLightbox(list, start = 0) {
  items = list.filter((x) => x?.src);
  if (!items.length) return;
  show(start);
  if (!box.open) box.showModal();
}

$('.lb-close').addEventListener('click', () => box.close());
$('.lb-prev').addEventListener('click', () => show(index - 1));
$('.lb-next').addEventListener('click', () => show(index + 1));
// A click on the dark area (not the picture or a button) closes.
box.addEventListener('click', (e) => {
  if (e.target === box || e.target === stage) box.close();
});
box.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') show(index - 1);
  else if (e.key === 'ArrowRight') show(index + 1);
  else if (e.key === '+' || e.key === '=') zoomAt(1.4, innerWidth / 2, innerHeight / 2);
  else if (e.key === '-') zoomAt(1 / 1.4, innerWidth / 2, innerHeight / 2);
  else if (e.key === '0') reset();
});
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX, e.clientY);
  },
  { passive: false },
);
// Mouse double-click (touch double taps are handled with the pointer events below; the browser's
// own dblclick after a double tap would undo them).
let lastPointer = 'mouse';
img.addEventListener('dblclick', (e) => {
  if (lastPointer === 'touch') return;
  if (view.scale > 1.01) reset();
  else zoomAt(2.5, e.clientX, e.clientY);
});

// Touch and mouse: one pointer drags (pans when zoomed, swipes when not); two pointers pinch.
const pts = new Map();
let gesture = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.target !== img) return;
  lastPointer = e.pointerType;
  stage.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) gesture = { kind: 'drag', x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y, t: performance.now(), tapAt: gesture?.tapAt };
  else if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: view.scale };
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId) || !gesture) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.kind === 'pinch' && pts.size === 2) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((gesture.s0 * d) / gesture.d0 / view.scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
  } else if (gesture.kind === 'drag') {
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;
    if (view.scale > 1.01) {
      view.x = gesture.vx + dx;
      view.y = gesture.vy + dy;
      clamp();
      apply();
    } else img.style.transform = `translateX(${dx}px)`;
  }
});
function end(e) {
  if (!pts.has(e.pointerId)) return;
  pts.delete(e.pointerId);
  if (gesture?.kind !== 'drag') {
    if (!pts.size) gesture = null;
    return;
  }
  const dx = e.clientX - gesture.x0;
  const dy = e.clientY - gesture.y0;
  const now = performance.now();
  // Double tap zooms in (or back out). Touch screens don't all send dblclick.
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && e.pointerType === 'touch') {
    if (gesture.tapAt && now - gesture.tapAt < 400) {
      if (view.scale > 1.01) reset();
      else zoomAt(2.5, e.clientX, e.clientY);
      gesture = null;
      return;
    }
    if (view.scale <= 1.01) apply();
    gesture = { kind: 'idle', tapAt: now };
    return;
  }
  // Not zoomed: a sideways swipe goes to the next or previous picture.
  if (view.scale <= 1.01) {
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    else apply();
  }
  gesture = null;
}
stage.addEventListener('pointerup', end);
stage.addEventListener('pointercancel', end);

// Share: the system share sheet where there is one (phones, some desktops); otherwise hidden.
const canShareFiles = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] });
$('.lb-share').hidden = !canShareFiles;
// On iPhone the share sheet has "Save Image"; a download link does nothing in the app there.
if (window.SaraPhone?.platform === 'ios' && canShareFiles) $('.lb-save').hidden = true;
$('.lb-share').addEventListener('click', async () => {
  try {
    const blob = await (await fetch(items[index].src)).blob();
    await navigator.share({ files: [new File([blob], $('.lb-save').download, { type: blob.type || 'image/jpeg' })], title: items[index].label ?? '' });
  } catch {
    /* cancelled */
  }
});
// The phone apps save through their own bridge when they have one.
$('.lb-save').addEventListener('click', (e) => {
  if (window.SaraPhone?.savePicture) {
    e.preventDefault();
    window.SaraPhone.savePicture(new URL(items[index].src, location.href).href, $('.lb-save').download.replace(/\.jpg$/, ''));
  }
});
box.addEventListener('close', () => {
  img.removeAttribute('src');
  pts.clear();
  gesture = null;
});
