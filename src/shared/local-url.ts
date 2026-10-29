/**
 * "local:" URL for a file on disk. "#", "?" and "%" are escaped: a folder like
 * "Outbreak - File #2" otherwise cut the URL at the "#" and the cover never loaded.
 */
export const toLocalUrl = (filePath: string) =>
  `local:${filePath
    .replaceAll("%", "%25")
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F")}`;

/** File path back from a "local:" request URL (any real query/fragment is dropped). */
export const fromLocalUrl = (requestUrl: string) => {
  const raw = requestUrl.slice("local:".length).split(/[?#]/)[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return decodeURI(raw);
  }
};

/**
 * A "local:" URL already built (maybe stored before "#"/"?" were escaped): forward slashes and
 * those two characters escaped, nothing else touched — so an escaped URL is never escaped twice.
 */
export const normalizeLocalUrl = (localUrl: string) =>
  `local:${localUrl
    .slice("local:".length)
    .replaceAll("\\", "/")
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F")}`;
