// Phase 41: short guided tours. A tour is a list of steps; each step points at one thing on the
// screen (a ring around it) with a card that says what it is, plus Back / Next / Skip. A step can
// first open the right window or page. Nothing is clicked for the owner; nothing is saved.

/**
 * @typedef {{ sel: string, title: string, text: string, before?: () => (void|Promise<void>) }} Step
 */

let active = null;

/** Starts a tour. `t` personalizes text (her name and pronouns). */
export async function startTour(steps, t = (s) => s, onEnd = () => {}) {
  endTour();
  const ring = document.createElement('div');
  ring.className = 'tour-ring';
  const card = document.createElement('div');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  const title = document.createElement('strong');
  const text = document.createElement('p');
  const foot = document.createElement('div');
  foot.className = 'tour-foot';
  const count = document.createElement('span');
  count.className = 'muted small';
  const skip = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost small', textContent: t('Skip tour') });
  const back = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost small', textContent: t('Back') });
  const next = Object.assign(document.createElement('button'), { type: 'button', className: 'small', textContent: t('Next') });
  foot.append(count, skip, back, next);
  card.append(title, text, foot);
  const state = { i: 0, ring, card, onEnd, steps };
  active = state;

  const place = () => {
    const step = steps[state.i];
    const target = step && document.querySelector(step.sel);
    // Live in the top layer of the open dialog when there is one, else the page.
    const host = target?.closest('dialog[open]') ?? document.querySelector('dialog[open]') ?? document.body;
    if (ring.parentNode !== host) host.append(ring);
    if (card.parentNode !== host) host.append(card);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(340, vw - 16);
    card.style.setProperty('--tour-w', `${w}px`);
    if (!target || !target.getClientRects().length) {
      ring.hidden = true;
      card.style.setProperty('--tour-x', `${(vw - w) / 2}px`);
      card.style.setProperty('--tour-y', `${Math.max(16, vh / 2 - card.offsetHeight / 2)}px`);
      return;
    }
    const r = target.getBoundingClientRect();
    ring.hidden = false;
    ring.style.setProperty('--tour-x', `${r.left - 6}px`);
    ring.style.setProperty('--tour-y', `${r.top - 6}px`);
    ring.style.setProperty('--tour-rw', `${r.width + 12}px`);
    ring.style.setProperty('--tour-rh', `${r.height + 12}px`);
    const h = card.offsetHeight;
    let top = r.bottom + 14;
    if (top + h > vh - 8) top = r.top - h - 14;
    if (top < 8) top = Math.min(vh - h - 8, Math.max(8, r.top + 8));
    let left = r.left + r.width / 2 - w / 2;
    // Beside a tall thing (a sidebar), not on top of it.
    if (r.height > vh * 0.5) left = r.right + 14 + w < vw ? r.right + 14 : Math.max(8, r.left - w - 14);
    left = Math.max(8, Math.min(left, vw - w - 8));
    card.style.setProperty('--tour-x', `${left}px`);
    card.style.setProperty('--tour-y', `${top}px`);
  };

  const show = async () => {
    const step = steps[state.i];
    try {
      await step.before?.();
    } catch {
      /* the page couldn't open: the card still shows */
    }
    // Let a page open or a sidebar finish sliding in before measuring where things are.
    await new Promise((r) => setTimeout(r, step.before ? 380 : 120));
    if (active !== state) return;
    document.querySelector(step.sel)?.scrollIntoView?.({ block: 'nearest' });
    title.textContent = t(step.title);
    text.textContent = t(step.text);
    count.textContent = `${state.i + 1} / ${steps.length}`;
    back.hidden = state.i === 0;
    next.textContent = state.i === steps.length - 1 ? t('Done') : t('Next');
    place();
    next.focus({ preventScroll: true });
  };
  state.place = place;
  next.addEventListener('click', () => {
    if (state.i >= steps.length - 1) return endTour();
    state.i++;
    void show();
  });
  back.addEventListener('click', () => {
    state.i = Math.max(0, state.i - 1);
    void show();
  });
  skip.addEventListener('click', () => endTour());
  await show();
}

export function endTour() {
  if (!active) return;
  const s = active;
  active = null;
  s.ring.remove();
  s.card.remove();
  s.onEnd();
}

export function tourRunning() {
  return Boolean(active);
}

window.addEventListener('resize', () => active?.place());
document.addEventListener('transitionend', () => active?.place(), true);
document.addEventListener('scroll', () => active?.place(), true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && active) {
    e.preventDefault(); // don't close the window under the tour as well
    e.stopPropagation();
    endTour();
  }
}, true);
