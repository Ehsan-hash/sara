export function table(items) {
  const width = Math.max(4, ...items.map((i) => i.name.length));
  return [`${'NAME'.padEnd(width)}  QTY`, ...items.map((i) => `${i.name.padEnd(width)}  ${String(i.qty).padStart(3)}`)].join('\n');
}

const csvField = (v) => {
  const s = String(v);
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csv(items) {
  return ['sku,name,qty', ...items.map((i) => [i.sku, i.name, i.qty].map(csvField).join(','))].join('\n');
}

export function json(items) {
  return JSON.stringify(items, null, 2);
}

export const FORMATS = { table, csv, json };
