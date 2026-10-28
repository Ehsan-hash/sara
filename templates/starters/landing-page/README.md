# __PROJECT_NAME__

A static landing page: plain HTML and CSS, no build step, no packages. It is accessible (skip
link, labels, alt text, visible focus, reduced motion), responsive (works on phones) and has a
dark mode.

## See it

Open `index.html` in a browser. To serve it: `npx serve .` or `python -m http.server`.

## Test it

```sh
npm test
```

The tests check the accessibility basics (one h1, labels, alt text, language, no inline styles)
and the responsive CSS.

## Files

- `index.html`: the page. Change the words first.
- `style.css`: colours are at the top (`:root`).
- `hero.svg`: the picture; replace it with your own (keep the `alt` text up to date).
