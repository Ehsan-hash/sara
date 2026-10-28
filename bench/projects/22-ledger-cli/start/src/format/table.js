/** A plain-text table; `right` lists the columns to align right. */
export function renderTable(header, rows, { right = [] } = {}) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) =>
    cells
      .map((c, i) => (right.includes(i) ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n') + '\n';
}
