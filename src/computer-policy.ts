// Phase 87 (computer use CU1, docs/design/COMPUTER_USE.md §6.4 and §7.3): the risk rows for
// looking and navigating in the Sara browser on the owner's computer. Pure (no I/O): the tool
// gathers the facts (the owner's message, her jobs' ports, the sites already allowed in this task)
// and this decides allow / ask / block. CU2 adds the acting rows (click, type, payments…).
//
// Rows in CU1:
//   look (pc_browser_look/read/logs/tabs/request, pc_devices)             → allow
//   open a site the owner named in this task, or one allowed in this task → allow
//   localhost where one of her jobs listens (the OS check of previews)    → allow
//   a preview link of this server (/preview/<token>/)                     → allow
//   any other site, or another localhost port                             → ask once per site per task
//   private conversation or private local mode: anything but localhost    → block
//   anything that isn't http(s), credentials in the address               → block
// The device refuses on its own as well (the server's own origin, chrome://, file://…), whatever
// the server decides here.

export type Verdict = { act: 'allow'; why: string } | { act: 'ask'; site: string; why: string } | { act: 'block'; why: string };

export interface NavFacts {
  /** The owner's message this task answers (sites named there are allowed). */
  ownerText: string;
  /** Sites (origins) already allowed in this task. */
  granted: ReadonlySet<string>;
  /** A private conversation or private local mode: only this computer's own addresses. */
  localOnly: boolean;
  /** Does one of her jobs listen on this localhost port? */
  jobPort: (port: number) => boolean;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const isLoopback = (host: string): boolean => LOOPBACK.has(host.toLowerCase()) || /^127\.\d+\.\d+\.\d+$/.test(host);

/** The origin of an address as the owner would say it ("github.com", "localhost:5173"). */
export function siteOf(u: URL): string {
  return u.host.toLowerCase();
}

/** Sites named in the owner's words: full addresses, and bare host names like github.com. */
export function namedSites(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)) {
    try {
      out.add(new URL(m[0]).host.toLowerCase());
    } catch {
      /* not an address */
    }
  }
  for (const m of text.matchAll(/\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(:\d{2,5})?\b/gi)) out.add(`${m[1]}${m[2] ?? ''}`.toLowerCase());
  for (const m of text.matchAll(/\b(localhost|127\.0\.0\.1):(\d{2,5})\b/gi)) out.add(`${m[1].toLowerCase()}:${m[2]}`);
  return out;
}

export function navigationVerdict(raw: string, facts: NavFacts): Verdict {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { act: 'block', why: 'That is not a web address. Give a full address like https://example.com/ or http://localhost:5173/.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { act: 'block', why: 'The Sara browser only opens web addresses (http or https).' };
  if (u.username || u.password) return { act: 'block', why: 'Addresses with a user name or password in them are not opened.' };
  const site = siteOf(u);
  const loop = isLoopback(u.hostname);
  if (facts.localOnly && !loop) return { act: 'block', why: 'Private: only addresses on this computer (localhost) are opened here.' };
  if (/^\/preview\/[0-9a-f]{32}(\/|$)/.test(u.pathname) && !loop) return { act: 'allow', why: 'a preview link' };
  if (loop) {
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (facts.jobPort(port)) return { act: 'allow', why: 'one of her jobs listens there' };
    if (facts.granted.has(site)) return { act: 'allow', why: 'allowed in this task' };
    // The owner gave this exact address ("my app at localhost:5173").
    const named = namedSites(facts.ownerText);
    if (named.has(site) || named.has(`localhost:${port}`) || named.has(`127.0.0.1:${port}`)) return { act: 'allow', why: 'the owner named it' };
    return { act: 'ask', site, why: `a program on this computer (port ${port}) that isn't one of her jobs` };
  }
  if (facts.granted.has(site)) return { act: 'allow', why: 'allowed in this task' };
  const named = namedSites(facts.ownerText);
  const bare = site.replace(/^www\./, '');
  if (named.has(site) || named.has(bare) || named.has(`www.${bare}`)) return { act: 'allow', why: 'the owner named it' };
  return { act: 'ask', site, why: 'a site you did not name' };
}

/** §7.5: text on a page that tries to give her orders is flagged (the page is data, never instructions). */
export function injectionHints(text: string): string[] {
  const out: string[] = [];
  const t = text.toLowerCase();
  for (const [re, what] of [
    [/ignore (?:all |any )?(?:previous|prior|above) (?:instructions|messages)/, 'asks her to ignore her instructions'],
    [/(?:type|enter|paste) (?:your|the) (?:password|passcode|token|api key)/, 'asks for a password or key'],
    [/open (?:the )?(?:settings|control panel|terminal|command prompt|powershell)/, 'asks her to open system settings or a terminal'],
    [/you are now|new instructions:|system prompt/, 'pretends to be her instructions'],
  ] as [RegExp, string][]) {
    if (re.test(t)) out.push(what);
  }
  return out;
}
