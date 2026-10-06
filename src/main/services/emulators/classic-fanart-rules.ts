/**
 * Full-screen art for emulated games from the LaunchBox Games DB ("Fanart - Background", 1920px
 * to 4K). The index is {platform key: {normalised title: image file}}; it is built from LaunchBox's
 * public Metadata.zip (see resources/classic-fanart-index.json).
 */
export type FanartIndex = Record<string, Record<string, string>>;

export const LAUNCHBOX_IMAGES = "https://images.launchbox-app.com/";

/** Opus platform name → index key (same consoles as the index). */
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
  return null;
};

/** Same normalisation as the index builder: no accents, tags, articles or punctuation. */
export const normaliseFanartTitle = (title: string) =>
  title
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
 * The fanart file for a game: an exact title match, or the only indexed title that starts with
 * it ("Resident Evil 3" → "resident evil 3 nemesis"). Ambiguous prefixes give nothing, so a game
 * never gets another game's art.
 */
export const findFanart = (
  index: FanartIndex,
  platform: string | null | undefined,
  title: string
): string | null => {
  const key = fanartPlatformKey(platform);
  const bucket = key ? index[key] : undefined;
  const wanted = normaliseFanartTitle(title);
  if (!bucket || wanted.length < 3) return null;
  if (bucket[wanted]) return LAUNCHBOX_IMAGES + bucket[wanted];
  // "Pokemon Fire Red" vs "pokemon firered version": same words, other spacing.
  const compact = wanted.replace(/ /g, "");
  const prefix = `${wanted} `;
  const candidates = new Set(
    Object.entries(bucket)
      .filter(([name]) => {
        if (name.startsWith(prefix)) return true;
        const joined = name.replace(/ /g, "");
        return joined === compact || joined === `${compact}version`;
      })
      .map(([, file]) => file)
  );
  return candidates.size === 1 ? LAUNCHBOX_IMAGES + [...candidates][0] : null;
};

/**
 * Hero pictures too small for a full screen: libretro box scans (512px), square disc covers,
 * Nintendo's 500px share images, or the box cover reused as hero.
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
