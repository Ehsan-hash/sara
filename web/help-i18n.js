// Phase 53: the help page in the app's language (the one this device last used): the menu, the
// headings, the opening line and "Getting started". The rest of the guide is English for now.
// Keys are the English text (for whole items of "Getting started": their HTML, so links and
// emphasis keep working); translations come from the same /i18n/<lang>.json as the app.
const norm = (s) => s.replace(/\s+/g, ' ').trim();
let lang = null;
try {
  lang = localStorage.getItem('sara.lang');
} catch {
  /* private mode */
}
// Never opened the app on this device: the browser's language, if the app speaks it.
if (!lang) {
  const c = String(navigator.language ?? '').toLowerCase();
  lang = c.startsWith('pt') ? 'pt-BR' : ['es', 'fr', 'de', 'it'].find((l) => c.startsWith(l)) ?? null;
}

async function translateHelp() {
  if (!lang || lang === 'en' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) return;
  const res = await fetch(`/i18n/${lang}.json`, { cache: 'no-cache' }).catch(() => null);
  if (!res?.ok) return;
  const dict = await res.json().catch(() => ({}));
  document.documentElement.lang = lang;
  const textOf = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE) continue;
      const tr = dict[norm(n.nodeValue)];
      if (tr) n.nodeValue = n.nodeValue.replace(norm(n.nodeValue), tr);
    }
  };
  const title = dict[norm(document.title)];
  if (title) document.title = title;
  for (const el of document.querySelectorAll('nav a, nav .brand, main h1, main h2, main h3, main > p.muted')) textOf(el);
  // "Getting started": whole items, so the links inside them stay.
  const start = document.getElementById('start');
  for (let el = start?.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
    for (const item of el.matches('ol, ul') ? el.children : [el]) {
      const tr = dict[norm(item.innerHTML)];
      if (tr) item.innerHTML = tr;
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void translateHelp());
else void translateHelp();
