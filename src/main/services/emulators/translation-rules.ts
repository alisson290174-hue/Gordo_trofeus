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

const TITLED_RE = /^(.*?(?:^|\/)(?:luma\/titles|atmosphere\/contents|titles|contents|mods)\/([0-9a-f]{16}))\/(?:romfs|exefs)\//i;
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
