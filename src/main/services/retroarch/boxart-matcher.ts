/**
 * Picks the libretro-thumbnails box art (No-Intro names like "Pokemon - FireRed Version (USA)")
 * for a ROM whose title only comes from its file name ("Pokemon Fire Red"). Translated ROMs have
 * their own CRC, so names are all there is to go on. Pure, so it can be unit-tested.
 */

const DROPPED_WORDS = /\b(?:the|version|and)\b/g;

/** "Kirby & The Amazing Mirror" and "Kirby And The Amazing Mirror" → "kirbyamazingmirror". */
export const compactTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(DROPPED_WORDS, "")
    .replace(/[^a-z0-9]/g, "");

const BAD_TAGS = /\((?:beta|proto|demo|sample|kiosk|pirate|unl|hack)[^)]*\)/i;

const RERELEASE = /\((?:[^)]*\b(?:virtual console|switch online|classic mini|collection|aftermarket)\b[^)]*)\)/i;

// Lower is better: the release a Brazilian player most likely recognises.
const regionRank = (name: string): number => {
  // Re-release scans only when no original cartridge box exists.
  if (RERELEASE.test(name)) return 10;
  if (/\(USA\)/.test(name)) return 0;
  if (/\(USA, Europe\)|\(World\)/.test(name)) return 1;
  if (/\(Brazil\)/.test(name)) return 2;
  if (/\(Europe\)/.test(name)) return 3;
  if (/\(Japan\)/.test(name)) return 5;
  return 4;
};

const baseOf = (name: string) => name.replace(/\s*[([].*$/, "").trim();

export function pickBoxart(title: string, names: readonly string[]): string | null {
  const wanted = compactTitle(title);
  if (wanted.length < 3) return null;

  let best: { name: string; score: number; rank: number } | null = null;
  for (const name of names) {
    if (BAD_TAGS.test(name)) continue;
    const base = baseOf(name);
    const candidate = compactTitle(base);
    let score = 0;
    if (candidate === wanted) {
      score = 2;
    } else if (wanted.length >= 8 && base.includes(" - ")) {
      // "Donkey Kong Country 3" → "Donkey Kong Country 3 - Dixie Kong's Double Trouble!":
      // the part before the subtitle must be the whole title, not just its start.
      if (compactTitle(base.split(" - ")[0]) === wanted) score = 1;
    }
    if (score === 0) continue;
    const rank = regionRank(name);
    if (
      !best ||
      score > best.score ||
      (score === best.score && rank < best.rank) ||
      (score === best.score && rank === best.rank && name.length < best.name.length)
    ) {
      best = { name, score, rank };
    }
  }
  return best?.name ?? null;
}
