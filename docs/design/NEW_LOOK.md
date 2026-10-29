# The new look (Phase 75, 2.5 → 2.7)

The owner's brief (2026-10-29): "This is an advanced system that really can do a lot and will do a lot
more. It seems like we could build this to make it look like the advanced system that it is instead of
something that is pretty normal." Decisions: the combined direction below; **dark is the default, light
is an option**; built in three stages; **mobile browsers get the same concept as desktop** (they are used
a lot); the **Windows and Mac apps get this look or better**, with native value that makes installing them
worth it.

Concept images (mood boards, labels are not final): `outputs/ui-review/concepts/A-her-presence.jpg`,
`B-command-center.jpg`, `C-today-tiles.jpg` (gitignored, local).

## The idea in one line

Show what she is doing. Today the app hides her work (grey `$ curl` boxes, a "92.6k tokens" footnote, a
mood in tiny header text). The new look puts her presence, her steps and her results on screen, calmly:
friendly first, the advanced detail one tap away.

## Visual language

- **Dark default** ("night"): deep plum-navy background `#0f0d17`, raised surfaces `#17141f` / `#1e1a29`,
  frosted panels (`backdrop-filter: blur(18px) saturate(140%)` over `rgba(30,26,41,.72)`), hairline borders
  `rgba(255,255,255,.08)`. Light ("day"): warm cream `#faf7f5`, white cards, blush and lavender tints.
- **Accent:** a rose → violet gradient (`#e0607e → #9b6bff`) used sparingly: the send button, her glow, the
  active place, progress. Text accent `#f08aa5` (dark) / `#b8436a` (light). Success `#4fd1a5`, warn
  `#f5b452`, danger `#ff6b7d`. Every pair meets WCAG AA contrast.
- **Type:** system UI stack (Inter if installed), 15 px body, 13 px meta, headings 600 weight with
  tight letter-spacing; numbers tabular.
- **Shape and depth:** radius 14 (cards) / 10 (controls) / 999 (pills); soft shadows in light, glow edges in
  dark; 4 px spacing grid.
- **Motion:** 150-250 ms ease-out; her glow breathes slowly while she thinks and pulses while she speaks;
  steps appear one by one. `prefers-reduced-motion` turns all of it off.
- All of it as CSS custom properties in one place (`web/theme.css`), so every screen, the offline page and
  the native apps' first paint use the same tokens. No inline `style=`.

## Stage 1 (2.5): her work on screen

1. **Step line under each reply:** "Remembered 2 things · Checked the weather 0.4 s · Looked at your
   calendar", built from the tool/memory events the chat stream already sends. Collapsed by default, one
   tap opens the details (command, output, timings). Replaces the grey command boxes. While she works the
   line is live ("Checking the weather…").
2. **Result cards** in the chat for the common results: weather (from the weather tool or a `wttr.in`
   call), task / reminder / note created, calendar events, files changed (with a diff count), test or job
   result, smart-home action, photo/moment, search results with sources. Cards are generated from the
   tool result data, never from guessing her text. Unknown tools keep the step line only.
3. **Messages:** her messages lose the heavy bubble (text on the surface with a thin accent line and her
   small avatar at the start of a run); yours stay a compact accent bubble. Message actions (copy, pin,
   heart, regenerate) appear on hover / long-press instead of always-on rows.
4. **Composer:** one floating frosted bar: text first, then a "+" for attach/photo/dice and the call,
   video and mic buttons; Send is the gradient button. The context-usage footnote becomes a small ring in
   the header ("this conversation is 46% full", detail on tap).
5. **Theme switch:** dark by default for new and existing users unless they picked light; Settings →
   Look → Theme: Night (default) / Day / Follow the system.

## Stage 2 (2.6): her presence

- **Desktop:** a fold-away right panel: her portrait with a glow that follows her mood, mood and status in
  words, then **Now** (what she is doing, background jobs with progress, approvals waiting with Allow /
  Deny), **Today** (next events and tasks), **She remembered** (memories used in this reply), and the
  conversation's model / workspace / privacy. Remembers open or closed.
- **Phone:** the same panel as a bottom sheet pulled up from her face in the header (peek height shows
  her mood and "Now"), so the concept is identical.
- ⌘K / Ctrl+K command bar (and a search button on phones): jump to any place, conversation, setting or
  action.

## Stage 3 (2.7): Today and the rest

- **Today** becomes the home: greeting with her face, then tiles (weather, your day, Planner, She
  remembered, Moments, coding job, home controls) in a grid that becomes one column on phones.
- Every other screen moves onto the new tokens (cards, headers, lists), including Settings, the setup and
  sign-in screens and the offline page.
- **Phones:** a bottom bar (Chat, Today, Planner, More) at phone width instead of only the drawer.

## Native apps (all stages)

Contract between the apps and the page: the app adds `shell-windows` or `shell-mac` to `<html>` and sets
`window.saraShell = { platform, titlebar: <px> }` before the page scripts run. The page then leaves a
drag strip of that height at the top (`app-region: drag`, buttons inside it `no-drag`) and draws its own
header there.

- **Windows 11:** dark title bar following the theme (`DWMWA_USE_IMMERSIVE_DARK_MODE`), Mica backdrop
  (`DWMWA_SYSTEMBACKDROP_TYPE`) with the page background matching, the page drawn into the title area
  (WebView2 non-client region support), a dark splash in the theme colour instead of a white flash.
- **Mac:** full-size content view with a transparent title bar, traffic lights inset into the page header,
  `NSVisualEffectView` behind the sidebar, dark/light following the theme.
- **Worth installing:** a global shortcut (Windows `Alt+Shift+S`, Mac `⌥⇧S`, changeable) that opens a small
  floating **quick-ask** window over any app (type or talk; the answer can open in the full app); her face
  and mood in the tray/menu-bar menu with "Now" (jobs, approvals waiting); native notifications for
  reminders and approvals with Allow / Deny buttons; drag files onto the dock/taskbar icon to give them to
  her; start at sign-in.

## Rules that stay

Mandatory safety layer unchanged (AI disclosure screens and notices keep their place and wording); every
setting keeps a **?** tip; all text through `t()` in six languages; ids, deep links, keyboard shortcuts and
the tour keep working; 44 px touch targets; screen-reader labels; works at 320 px wide and 200% zoom.
