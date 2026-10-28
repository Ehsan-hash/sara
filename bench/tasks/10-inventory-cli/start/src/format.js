export function table(items) {
  const width = Math.max(4, ...items.map((i) => i.name.length));
  return [`${'NAME'.padEnd(width)}  QTY`, ...items.map((i) => `${i.name.padEnd(width)}  ${String(i.qty).padStart(3)}`)].join('\n');
}
