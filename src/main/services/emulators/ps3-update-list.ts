/** Full PS3 firmware image (not the incremental patch) on Sony's CDN, plus the MD5 in its path. */
const PUP_URL_RE =
  /^http:\/\/dus01\.ps3\.update\.playstation\.net\/update\/ps3\/image\/us\/\d{4}_\d{4}_([0-9a-f]{32})\/PS3UPDAT\.PUP$/i;

export const parsePs3UpdateList = (
  list: string
): { url: string; md5: string } | null => {
  for (const match of list.matchAll(/CDN=([^;\s]+)/g)) {
    const pup = PUP_URL_RE.exec(match[1]);
    if (pup) return { url: match[1], md5: pup[1].toLowerCase() };
  }
  return null;
};
