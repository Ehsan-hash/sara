export function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Bad date: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(d, n) {
  return new Date(d.getTime() + n * 86_400_000);
}

export function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
