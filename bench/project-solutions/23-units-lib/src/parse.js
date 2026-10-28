// "5 ft", "2.5kg", "1 1/2 cups", "350 ML" → { value, unit }. Units come from the registry.
import './dimensions/index.js';
import { UnitError } from './errors.js';
import { leadingNumber } from './numbers.js';
import { unitFor } from './registry.js';

export function lookupUnit(word) {
  const key = word.trim().replace(/\s+/g, ' ').toLowerCase();
  return unitFor(key) ?? unitFor(key.replace(/\.$/, ''));
}

export function parse(text) {
  if (typeof text !== 'string') throw new UnitError('parse() needs text.');
  const num = leadingNumber(text);
  if (!num) throw new UnitError(`No number in "${text}".`);
  const word = num.rest.trim();
  if (!word) throw new UnitError(`No unit in "${text}".`);
  const unit = lookupUnit(word);
  if (!unit) throw new UnitError(`Unknown unit "${word}".`);
  return { value: num.value, unit };
}

/** Several quantities in one text: "5 ft 3 in", "1 kg 200 g". */
export function parseAll(text) {
  const out = [];
  const re = /(-?[\d.,/½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s+\d+\/\d+)?)\s*([^\d\s][^\d]*?)(?=\s+-?[\d½¼¾⅓⅔⅛⅜⅝⅞]|$)/gu;
  for (const m of text.trim().matchAll(re)) out.push(parse(`${m[1]} ${m[2]}`));
  if (!out.length) throw new UnitError(`No quantities in "${text}".`);
  return out;
}
