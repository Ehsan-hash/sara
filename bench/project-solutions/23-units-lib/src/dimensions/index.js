// Loads the built-in units into the registry (in this order: unitsOf keeps it).
import './length.js';
import './mass.js';
import './volume.js';
import './temperature.js';
import { addSpellings } from '../registry.js';

// Spellings that are only for parsing.
addSpellings('floz', ['fl. oz', 'fl.oz', 'fluid oz']);
addSpellings('tbsp', ['tbs', 'tablespoon(s)']);
addSpellings('C', ['deg c']);
addSpellings('F', ['deg f']);

export { unitsOf } from '../registry.js';
