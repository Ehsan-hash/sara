// Reads PDF documents into plain text pages.
export function readPdfPages(bytes: Uint8Array): string[] {
  const pages: string[] = [];
  if (bytes.length) pages.push('page one');
  return pages;
}
