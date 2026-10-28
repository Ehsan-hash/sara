// Length units: names, aliases and decimals (factors are in src/registry.js).
export const LENGTH = {
  m: { one: 'metre', other: 'metres', aliases: ['meter', 'meters'], decimals: 2 },
  km: { one: 'kilometre', other: 'kilometres', aliases: ['kilometer', 'kilometers'], decimals: 3 },
  cm: { one: 'centimetre', other: 'centimetres', aliases: ['centimeter', 'centimeters'], decimals: 1 },
  mm: { one: 'millimetre', other: 'millimetres', aliases: ['millimeter', 'millimeters'], decimals: 0 },
  mi: { one: 'mile', other: 'miles', aliases: [], decimals: 2 },
  yd: { one: 'yard', other: 'yards', aliases: [], decimals: 2 },
  ft: { one: 'foot', other: 'feet', aliases: ["'"], decimals: 2 },
  in: { one: 'inch', other: 'inches', aliases: ['"'], decimals: 2 },
};
