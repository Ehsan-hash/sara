# Notes for customising (for the assistant)

- Ask the owner for: the one-line promise, 3 benefits, the price, and a contact address.
- Keep one `<h1>`, headings in order, `alt` on every image, a `<label for>` for every field and no
  `style="..."` attributes; `npm test` checks these.
- Colours live in `:root` in `style.css` (and the dark mode block); check contrast stays readable.
- The form uses `mailto:`; for a real form, point `action` at the owner's form service.
- Run `npm test` after every change.
