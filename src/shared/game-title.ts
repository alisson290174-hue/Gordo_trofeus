/**
 * ROM file names carry dump tags that aren't part of the game's name:
 * "Marvel Ultimate Alliance 2 (U) [SLUS-21879]", "Killzone (BR-EUR) (T1.2) (www.romsportugues.com)",
 * "Battle Stadium D.O.N (English 09-07-23)[English Voices]". This keeps only the name, so every
 * screen shows the same clean title. Used for classics (launchbox) and custom games only —
 * Steam names are already official.
 */
export function cleanRomTitle(raw: string | null | undefined): string {
  const original = (raw ?? "").trim();
  if (!original) return original;

  let title = original
    .replace(/\.(iso|bin|cue|chd|cso|img|mdf|nrg|gz|zip|7z|rar)$/i, "")
    .replace(/_/g, " ")
    // (…) and […] tags: region, language, version, serial, translation group, site.
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    // Loose site names left outside brackets.
    .replace(/\s*-?\s*(www\.)?[a-z0-9-]+\.(com|net|org|br)(\.br)?\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–:,.]+$/, "")
    .trim();

  // Everything was tags (e.g. "[SLUS-21879]") — keep the original rather than an empty string.
  if (!title) title = original;
  return title;
}

/** Display title for any library game: ROM names cleaned, trademark marks dropped. */
export function displayGameTitle(
  title: string | null | undefined,
  shop?: string | null
): string {
  const base = shop === "steam" ? (title ?? "").trim() : cleanRomTitle(title);
  return base.replace(/[™®©]/g, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Shops whose games exist only on this PC: never sent to the Opus server, no server catalogue,
 * achievements or stats (custom executables and Epic games through Legendary).
 */
export const isLocalOnlyShop = (shop: string | null | undefined): boolean =>
  shop === "custom" || shop === "epic";
