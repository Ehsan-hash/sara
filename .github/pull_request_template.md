## What this changes

<!-- One or two sentences: what it does for the person using Sara. Link the issue: "Fixes #123". -->

## How I checked it

- [ ] `npm run check` passes (paste the `ℹ tests` / `ℹ pass` / `ℹ fail 0` lines below)
- [ ] `node scripts/public-export.ts --check-only` finds nothing
- [ ] New behaviour has tests; no test was weakened or removed to make it pass
- [ ] Tried it by hand (say how), or not needed

```
ℹ tests …
ℹ pass …
ℹ fail 0
```

## The rules

- [ ] No new runtime dependencies; no build step; erasable TypeScript only
- [ ] Written from scratch (anything downloaded or called is credited in docs/CREDITS.md)
- [ ] The safety layer is untouched, or the change makes it stronger and has a test
- [ ] No credentials or personal data anywhere (code, tests, docs, screenshots)
- [ ] New visible text is in `web/i18n/*.json`; new settings have a tip in `web/tips.json`
- [ ] Docs updated (README, docs/, the in-app guide) if anything a user sees changed

## Screenshots

<!-- For anything visible: before and after, desktop and phone width if it matters. -->
