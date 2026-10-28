/** The segments of a path: query string dropped, empty segments ignored. */
export function splitPath(path) {
  return path.split('?')[0].split('/').filter(Boolean);
}
