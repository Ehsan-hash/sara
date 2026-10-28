# The settings format

`parse(text)` returns a dict: section name → dict of key → value (all values are strings).

1. **Sections.** A line `[name]` starts a section. The name is trimmed and **case-sensitive**.
   Keys that come before any section go in the section `""` (which always exists).
2. **Keys.** `key = value` or `key: value`: the first `=` or `:` separates the key from the value.
   Keys are trimmed and **lowercased**. Values are trimmed and may be empty. If a key appears
   twice in a section, the last one wins.
3. **Comments.** A line whose first non-blank character is `;` or `#` is a comment. Inside a
   value, a `;` or `#` that has whitespace right before it starts a comment that runs to the end
   of the line (`port = 80 ; web` gives `80`); one without whitespace before it is part of the
   value (`C:\data#1` stays as it is).
4. **Continuation lines.** A line that starts with whitespace, right after a key line or another
   continuation line, adds to that key's value: its trimmed text (inline comments removed) is
   appended with a newline (`\n`) in between. Comment lines in between are skipped; a blank line
   or a section line ends the value.
5. **Errors.** Any other line raises `ParseError` (a subclass of `ValueError`) whose message
   starts with `line <n>:` (lines counted from 1).

# Helpers

- `get(cfg, path, default=None)`: `path` is `section.key`; the section is everything before the
  **last** dot (so it may contain dots); a path without a dot means section `""`. The key part
  is compared in lowercase. Returns `default` when missing.
- `get_bool(cfg, path, default=None)`: `yes/no`, `true/false`, `on/off` and `1/0`, in any case.
  Missing gives `default`; any other value raises `ValueError`.
- `get_int(cfg, path, default=None)`: the value as an `int`; missing gives `default`.
