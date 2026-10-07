/**
 * Full-screen art from the LaunchBox Games DB ("Fanart - Background", 1920px to 4K). The index
 * is {platform key: {normalised title: [image files]}}, built from LaunchBox's public Metadata.zip
 * (scripts/build-fanart-index.py → resources/classic-fanart-index.json). A game can have several
 * backgrounds of very different sizes (640x480 scans next to 4K renders): Opus measures them and
 * keeps the first wide, sharp one.
 */
export type FanartIndex = Record<string, Record<string, string[]>>;

export const LAUNCHBOX_IMAGES = "https://images.launchbox-app.com/";

/** Opus platform name → index key (same consoles as the index; PC games use "pc"). */
export const fanartPlatformKey = (platform: string | null | undefined) => {
  const p = (platform ?? "").toLowerCase();
  if (!p) return null;
  if (/switch/.test(p)) return "switch";
  if (/3ds/.test(p)) return "3ds";
  if (/\bds\b|nintendo ds/.test(p)) return "ds";
  if (/game ?cube/.test(p)) return "gc";
  if (/wii/.test(p)) return "wii";
  if (/64/.test(p) && /nintendo|n64/.test(p)) return "n64";
  if (/super nintendo|snes|super famicom/.test(p)) return "snes";
  if (/advance|gba/.test(p)) return "gba";
  if (/game ?boy color|gbc/.test(p)) return "gbc";
  if (/game ?boy/.test(p)) return "gb";
  if (/nintendo entertainment|\bnes\b|famicom/.test(p)) return "nes";
  if (/portable|psp/.test(p)) return "psp";
  if (/playstation ?4|ps4/.test(p)) return "ps4";
  if (/playstation ?3|ps3/.test(p)) return "ps3";
  if (/playstation ?2|ps2/.test(p)) return "ps2";
  if (/playstation|ps1|psx/.test(p)) return "ps1";
  if (/xbox ?360/.test(p)) return "xbox360";
  if (/xbox/.test(p)) return "xbox";
  if (/genesis|mega ?drive/.test(p)) return "genesis";
  if (/^(pc|windows)$/.test(p)) return "pc";
  return null;
};

/** Same normalisation as the index builder: no accents, tags, articles or punctuation. */
export const normaliseFanartTitle = (title: string) =>
  title
    // Before NFKD, which would turn "™" into the letters "TM".
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    // Fan-translation marks that aren't part of the real name.
    .replace(/\bpt-?br\b|\btraduzido\b|\bdublado\b/g, " ")
    // "Parasite Eve CD 01", "Disc 2": the disc number isn't part of the name.
    .replace(/\b(cd|disc|disco|disk)\s*0*\d+\s*$/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .split(" ")
    .filter(Boolean)
    .join(" ");

/**
 * The fanart files of a game, best first: an exact title match, the same words joined
 * differently ("Fire Red" / "FireRed Version"), or the only indexed game whose title starts with
 * it ("Resident Evil 3" → "resident evil 3 nemesis"). Ambiguous prefixes give nothing, so a game
 * never gets another game's art.
 */
export const findFanart = (
  index: FanartIndex,
  platform: string | null | undefined,
  title: string
): string[] => {
  const key = fanartPlatformKey(platform);
  const bucket = key ? index[key] : undefined;
  const wanted = normaliseFanartTitle(title);
  if (!bucket || wanted.length < 3) return [];
  const toUrls = (files: string[]) => files.map((f) => LAUNCHBOX_IMAGES + f);
  if (bucket[wanted]) return toUrls(bucket[wanted]);
  const compact = wanted.replace(/ /g, "");
  const prefix = `${wanted} `;
  const candidates = new Map<string, string[]>();
  for (const [name, files] of Object.entries(bucket)) {
    const joined = name.replace(/ /g, "");
    if (
      name.startsWith(prefix) ||
      joined === compact ||
      joined === `${compact}version`
    ) {
      candidates.set(files[0], files);
    }
  }
  if (candidates.size === 1) return toUrls([...candidates.values()][0]);
  // "Hellblade: Senua's Sacrifice VR Edition", "… Remastered": try the base game's name.
  const base = wanted.replace(EDITION_SUFFIX, "");
  return base !== wanted ? findFanart(index, platform, base) : [];
};

const EDITION_SUFFIX =
  / (vr|definitive|complete|goty|game of year|remastered|enhanced|deluxe|ultimate|special|gold|anniversary|director s cut)( edition)?$/;

/** Sharp enough to fill the screen: at least 1280 px wide and wider than 3:2. */
export const isSharpHeroSize = (size: { width: number; height: number }) =>
  size.width >= 1280 && size.width / Math.max(1, size.height) >= 1.5;

/**
 * Hero pictures known to be too small without measuring: libretro box scans (512px), square disc
 * covers, Nintendo's 500px share images, or the box cover reused as hero.
 */
export const isWeakHero = (
  hero: string | null | undefined,
  cover?: string | null
) =>
  !hero ||
  hero === cover ||
  /thumbnails\.libretro\.com|xlenore\/(ps2|psx)-covers|nintendo\.com\/eu\/media\/images\/(10_share|11_square)/i.test(
    hero
  );

/**
 * Width/height from the first bytes of a JPEG, PNG or WebP (no full download needed).
 */
export const readImageSize = (
  bytes: Uint8Array
): { width: number; height: number } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: IHDR right after the signature.
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // WebP (VP8 / VP8L / VP8X).
  if (
    bytes.length >= 30 &&
    view.getUint32(0) === 0x52494646 &&
    view.getUint32(8) === 0x57454250
  ) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8 ")
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X")
      return {
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
      };
    return null;
  }
  // JPEG: walk the segments up to a start-of-frame marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame)
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      offset += 2 + length;
    }
  }
  return null;
};
