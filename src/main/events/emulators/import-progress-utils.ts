export const bandPercent = (
  start: number,
  span: number,
  processed: number,
  total: number
): number => {
  const frac = total > 0 ? Math.min(1, processed / total) : 0;
  return Math.min(100, Math.round((start + frac * span) * 10) / 10);
};

export const baseNameWithoutExt = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

const ROM_EXTENSION =
  /\.(?:cue|bin|iso|img|ccd|sub|mds|mdf|chd|cso|zso|pbp|ecm|gz|nrg|m3u|smc|sfc|gba|gbc|gb|nes|z64|n64|v64|zip|7z)$/i;

/**
 * A readable title for a ROM no catalogue knows, from its file name:
 * "Dino Crisis 2 (BR) (T1.0) (LEG) (www.romsportugues.com).cue" → "Dino Crisis 2".
 * Drops every (…)/[…] tag (region, translation, disc, site), stray URLs and doubled extensions.
 */
export const cleanRomTitle = (fileName: string): string => {
  let title = fileName;
  while (ROM_EXTENSION.test(title)) title = title.replace(ROM_EXTENSION, "");
  const cleaned = title
    .replace(/\s*[([][^()[\]]*[)\]]/g, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/_/g, " ")
    .replace(/\s*-?\s*\b(?:cd|disc|disk)\s*\d+\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s.-]+$/, "")
    .trim();
  return cleaned || baseNameWithoutExt(fileName);
};
