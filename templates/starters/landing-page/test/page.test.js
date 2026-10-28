// Accessibility and responsiveness basics, checked without a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('the page has a language, title, description and a mobile viewport', () => {
  assert.match(html, /<html lang="[a-z]{2}/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('exactly one h1, and headings in order', () => {
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `heading h${levels[i]} skips a level`);
});

test('every image has alt text and a size', () => {
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
    assert.match(img, /\balt="[^"]*"/, img);
    assert.match(img, /\bwidth="\d+"/, img);
  }
});

test('every form field has a label', () => {
  for (const m of html.matchAll(/<(input|textarea|select)\b[^>]*\bid="([^"]+)"/g)) assert.match(html, new RegExp(`<label for="${m[2]}"`), `no label for #${m[2]}`);
  for (const f of html.match(/<(input|textarea|select)\b[^>]*>/g) ?? []) assert.match(f, /\bid="/, `field without id: ${f}`);
});

test('a skip link, a named nav, no inline styles or scripts', () => {
  assert.match(html, /href="#main"/);
  assert.match(html, /<nav aria-label="[^"]+"/);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)/);
});

test('CSS: phone layout, reduced motion, visible focus, dark mode', () => {
  assert.match(css, /@media \(max-width:/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-color-scheme: dark/);
});
