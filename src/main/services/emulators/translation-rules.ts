/**
 * Pure rules for installing a fan translation (or any romfs/exefs mod) into an emulator, kept free
 * of Electron imports so they can be unit-tested.
 *
 * Translations ship in the console's mod layout: Luma's "luma/titles/<TitleID>/romfs" on 3DS,
 * Atmosphère's "atmosphere/contents/<TitleID>/romfs" on Switch, or a bare "romfs"/"exefs" folder.
 * Emulators read the same folders from their own mods directory, so installing is copying them.
 */

/** Anything that could run on the PC has no place in a translation: refuse the whole archive. */
const EXECUTABLE_RE = /\.(exe|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|scr|com|dll|cpl|lnk|jar|reg|sh)$/i;

export const findExecutables = (relativeFiles: string[]) =>
  relativeFiles.filter((file) => EXECUTABLE_RE.test(file));

export interface ModRoot {
  /** Folder (relative to the extracted archive, "/" separated) that holds romfs/ and/or exefs/. */
  root: string;
  /** Title ID taken from the folder path, upper-case, or null for a bare romfs. */
  titleId: string | null;
}

// Any folder named after a 16-hex title ID that holds romfs/exefs: luma/titles/<id>,
// atmosphere/contents/<id>, sxos/titles/<id>, Switch/Contents/<id> or just <id>/ at the top.
const TITLED_RE = /^((?:.*\/)?([0-9a-f]{16}))\/(?:romfs|exefs)\//i;
const BARE_RE = /^(.*?)(?:^|\/)?(?:romfs|exefs)\//i;

/** Every romfs/exefs root found among the extracted files, title-ID'd ones first. */
export const findModRoots = (relativeFiles: string[]): ModRoot[] => {
  const roots = new Map<string, ModRoot>();
  for (const raw of relativeFiles) {
    const file = raw.replace(/\\/g, "/");
    const titled = TITLED_RE.exec(file);
    if (titled) {
      roots.set(titled[1].toLowerCase(), { root: titled[1], titleId: titled[2].toUpperCase() });
      continue;
    }
    const bare = BARE_RE.exec(file);
    if (bare) {
      const root = bare[1].replace(/\/$/, "");
      if (!roots.has(root.toLowerCase())) roots.set(root.toLowerCase(), { root, titleId: null });
    }
  }
  return [...roots.values()].sort((a, b) => Number(b.titleId !== null) - Number(a.titleId !== null));
};

export type PickModRootResult =
  | { ok: true; root: ModRoot; titleId: string }
  | { ok: false; reason: "no_mod" | "wrong_game" | "unknown_title" };

/**
 * The root to install for a game. A bundle with several games (Pokémon X + Y) contributes only the
 * one matching the game; an archive made for another game is refused instead of installed blindly.
 */
export const pickModRoot = (roots: ModRoot[], gameTitleId: string | null): PickModRootResult => {
  if (roots.length === 0) return { ok: false, reason: "no_mod" };
  const wanted = gameTitleId?.toUpperCase() ?? null;
  const titled = roots.filter((root) => root.titleId !== null);

  if (titled.length > 0) {
    if (!wanted) return { ok: true, root: titled[0], titleId: titled[0].titleId as string };
    const match = titled.find((root) => root.titleId === wanted);
    return match ? { ok: true, root: match, titleId: wanted } : { ok: false, reason: "wrong_game" };
  }

  // Only bare romfs/exefs: trust it for the game the user picked it on.
  return wanted ? { ok: true, root: roots[0], titleId: wanted } : { ok: false, reason: "unknown_title" };
};

/** Passwords the Brazilian translation groups put on their archives (tried after none). */
export const KNOWN_TRANSLATION_PASSWORDS = ["", "João13", "joao13traducoes.com"];

const NAME_NOISE = new Set([
  "the", "and", "of", "de", "do", "da", "e", "a", "o", "pt", "br", "ptbr", "pt-br", "traducao",
  "tradução", "translation", "nx", "switch", "pkg", "tpkg", "trpkg", "nsp", "xci", "pc", "update",
  "dublagem", "nativo", "final", "rev", "v", "para", "versao", "versão", "deluxe", "hd",
]);

/** Comparable words of a game or archive name ("Kirby Forgotten Lands" → kirby, forgotten, land). */
export const titleWords = (name: string) =>
  new Set(
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
      .replace(/\.(rar|zip|7z)$/, "")
      .split(/[^a-z0-9]+/)
      .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
      // Version tags go ("v1", "1.5"); plain numbers stay, they tell sequels apart ("Underground 2").
      .filter((word) => word.length > 0 && !NAME_NOISE.has(word) && !/^v\d+(\.\d+)*$|^\d+\.\d+(\.\d+)*$/.test(word))
  );

/** "2", "64", "ii", "iii"…: a word that makes a different game of the same series. */
const SEQUEL_WORD = /^(\d+|i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,3})$/;

/**
 * The library game an archive without title IDs was made for, by name: every meaningful word of the
 * archive must be in the game's title (and vice versa for most of them), so "Mario Kart 8" never
 * lands on "Mario Party". Null when no game is a clear match.
 */
export const matchGameByName = <T extends { title: string }>(archiveName: string, games: T[]): T | null => {
  const wanted = titleWords(archiveName);
  if (wanted.size === 0) return null;
  let best: { game: T; score: number } | null = null;
  for (const game of games) {
    const have = titleWords(game.title);
    if (have.size === 0) continue;
    // A sequel number on either side must be on both: "Underground 2" is not "Underground".
    const sequelMismatch = [...have, ...wanted].some(
      (word) => SEQUEL_WORD.test(word) && !(have.has(word) && wanted.has(word))
    );
    if (sequelMismatch) continue;
    const shared = [...wanted].filter((word) => have.has(word)).length;
    let score = 0;
    if (shared === wanted.size) {
      score = shared / have.size;
    } else if (shared === have.size && have.size >= 2 && wanted.size - shared <= 2) {
      // The archive spells out a subtitle the library name lacks ("Resident Evil 3" → "… - Nemesis").
      score = 0.6;
    }
    if (score >= 0.6 && (!best || score > best.score)) best = { game, score };
  }
  return best?.game ?? null;
};
