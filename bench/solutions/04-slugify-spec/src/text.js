/** Prepares text for a slug: ß and &, accents removed, lowercased (SPEC.md steps 1-3). */
export function normalize(s) {
  return s
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
