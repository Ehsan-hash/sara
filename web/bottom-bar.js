// Phase 75 (stage 3, 2.7): the phone's bottom bar (720 px and narrower): Chat, Today, Planner and
// More (the sidebar's list of places, the drawer). The ☰ drawer stays for conversations.
// - The current place is lit (aria-current="page").
// - 44 px targets above the home indicator (safe-area inset), and it hides while the on-screen
//   keyboard is up, so it never sits between the message box and the keyboard.
// - A window (Planner, Memory…) leaves the bar visible below it. A tap on the bar closes the window
//   the normal way (unsaved changes still ask first) and then goes there. Windows that need an
//   answer (data-required), first-run setup, the call screen, the lightbox and the command bar are
//   left alone.
const $ = (sel) => document.querySelector(sel);

/** Which place the bar lights: an open window wins, then Today, then the open drawer, else the chat. */
export function currentPlace({ planner = false, otherWindow = false, today = false, drawer = false } = {}) {
  if (planner) return 'planner';
  if (otherWindow || drawer) return 'more';
  if (today) return 'today';
  return 'chat';
}

/** Text fields that bring up the on-screen keyboard (not ticks, buttons or pickers). */
export function typesText(n) {
  if (!n || typeof n.matches !== 'function') return false;
  if (n.isContentEditable) return true;
  if (n.matches('textarea')) return !n.readOnly;
  if (!n.matches('input')) return false;
  return !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/i.test(n.type || 'text') && !n.readOnly;
}

/** Windows a tap on the bar may close: modal, not a required question, not the call or a lightbox. */
const closable = (d) => d && d.open && d.id !== 'today' && d.id !== 'setup' && !d.dataset.required && !d.matches('.ring, .lightbox, .cmdbar');

let ctx = null;

function place() {
  const open = [...document.querySelectorAll('dialog[open]')].filter((d) => d.id !== 'today');
  return currentPlace({
    planner: open.some((d) => d.id === 'planner'),
    otherWindow: open.some((d) => !d.matches('.ring, .lightbox, .cmdbar')),
    today: ctx.todayOpen(),
    drawer: $('#main')?.classList.contains('show-sidebar'),
  });
}

function sync() {
  const bar = $('#bottom-bar');
  if (!bar) return;
  const here = place();
  const btns = [...bar.querySelectorAll('.bb-btn')];
  for (const b of btns) {
    if (b.dataset.bb === here) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  // 2.8: the glowing indicator slides to the lit place (web/polish.css reads --bb-i).
  const i = btns.findIndex((b) => b.dataset.bb === here);
  bar.style.setProperty('--bb-i', String(Math.max(0, i)));
  bar.dataset.lit = i < 0 ? 'none' : here;
  $('#bb-more')?.setAttribute('aria-expanded', String(Boolean($('#main')?.classList.contains('show-sidebar'))));
}

/** Goes to a place from the bar (the action of one button). */
async function go(where) {
  if (where === 'more') {
    if ($('#main').classList.contains('show-sidebar')) ctx.closeSidebar();
    // After this tap is done: the More list closes on any click outside it, this one included.
    else setTimeout(() => ctx.openMore(), 0);
    return sync();
  }
  ctx.closeSidebar();
  if (where === 'chat') ctx.closeToday();
  if (where === 'today') await ctx.openToday();
  if (where === 'planner') ctx.openPlanner();
  sync();
}

/** Closes a window through its ✕ (so unsaved changes ask first); resolves true once it is closed. */
function closeWindow(d) {
  return new Promise((resolve) => {
    const x = d.querySelector(':scope > .dialog-top > .dialog-x');
    if (x) x.click();
    else d.close();
    let n = 0;
    const tick = () => {
      if (!d.open) return resolve(true);
      if (++n > 40 || d.querySelector('.unsaved-bar')) return resolve(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

export function initBottomBar(c) {
  ctx = c;
  const bar = $('#bottom-bar');
  if (!bar) return;
  document.documentElement.classList.add('has-bbar');
  for (const b of bar.querySelectorAll('.bb-btn')) b.addEventListener('click', () => void go(b.dataset.bb));
  // A window is open over the page: the bar is visible below it but outside the window, so the tap
  // lands on the window's backdrop. Find the button under the finger, close the window, then go.
  window.addEventListener(
    'click',
    (e) => {
      const d = e.target;
      if (!(d instanceof HTMLDialogElement) || !closable(d) || getComputedStyle(bar).display === 'none') return;
      const hit = [...bar.querySelectorAll('.bb-btn')].find((b) => {
        const r = b.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();
      void closeWindow(d).then((closed) => {
        if (closed && !(hit.dataset.bb === 'planner' && d.id === 'planner')) void go(hit.dataset.bb);
        else sync();
      });
    },
    true,
  );
  // Lit place: windows opening and closing, Today, the drawer.
  new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  new MutationObserver(sync).observe($('#main'), { attributes: true, attributeFilter: ['class'] });
  // The team's "working" dot shows on More too.
  const dot = $('#more-dot');
  const bbDot = $('#bb-dot');
  if (dot && bbDot) {
    const copy = () => (bbDot.hidden = dot.hidden);
    new MutationObserver(copy).observe(dot, { attributes: true, attributeFilter: ['hidden'] });
    copy();
  }
  // The on-screen keyboard: hide the bar while a text field has the focus on a touch screen, or
  // while the visible area is much shorter than the window (the keyboard covers it).
  const root = document.documentElement;
  const coarse = matchMedia('(pointer: coarse)');
  const touch = () => coarse.matches || navigator.maxTouchPoints > 0;
  let tall = window.innerHeight;
  const kb = () => {
    tall = Math.max(tall, window.innerHeight);
    const vv = window.visualViewport;
    const shrunk = Boolean(vv) && vv.height < tall * 0.72;
    root.classList.toggle('kb-up', (touch() || shrunk) && typesText(document.activeElement));
    // 2.7.1: and once the keyboard is gone, the page back at the top (web/viewport.js).
    window.saraViewport?.settle();
  };
  document.addEventListener('focusin', kb);
  document.addEventListener('focusout', () => setTimeout(kb, 60));
  window.visualViewport?.addEventListener('resize', kb);
  window.addEventListener('orientationchange', () => {
    tall = 0;
    setTimeout(kb, 300);
  });
  sync();
}
