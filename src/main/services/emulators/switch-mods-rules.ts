/**
 * Which community mod folders (Fl4sh9174/Switch-Emulator-Ultrawide-FPS-Mods) Opus installs on its
 * own: smoothness and sharpness only. Ultrawide/aspect, fixed output resolutions, 30/120/240 FPS
 * and joke mods change how the game looks or plays, so they stay out. One 60 FPS variant at most.
 */

const KEEP = /60\s*-?\s*fps|level\s*of\s*detail|\blod\b|dynamic\s*resolution/i;
const SKIP =
  /ultra\s*wide|aspect|(?<![v\d.])\d{1,2}[.:]\d{1,2}(?![\d.])|\b\d{3,4}\s*x\s*\d{3,4}\b|\b[248]k\b|\b(?!60)\d{2,3}\s*-?\s*fps|handheld|big\s*head|parkour|\bnce\b|ryujinx/i;

const LOD = /level\s*of\s*detail|\blod\b/i;

export const pickSwitchModFolders = (folders: string[]): string[] => {
  const usable = folders.filter((name) => KEEP.test(name) && !SKIP.test(name));
  const fps = usable.filter(
    (name) => /60\s*-?\s*fps/i.test(name) && !/split\s*screen/i.test(name)
  );
  const bestFps =
    fps.find((name) => /static/i.test(name)) ??
    fps.find((name) => !/dynamic/i.test(name)) ??
    fps[0];
  // Detail variants overwrite the same code: one only, the moderate one first.
  const lods = usable.filter((name) => LOD.test(name) && !fps.includes(name));
  const bestLod =
    lods.find((name) => /improved/i.test(name)) ??
    lods.find((name) => !/max/i.test(name)) ??
    lods[0];
  return usable.filter(
    (name) =>
      (!fps.includes(name) || name === bestFps) &&
      (!lods.includes(name) || name === bestLod)
  );
};

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word && word !== "the" && word !== "mods");

/** Pack for a game whose title id is unknown (file name without it): same title words. */
export const matchModPackByTitle = (
  files: string[],
  title: string
): string | null => {
  const wanted = words(title).join(" ");
  if (!wanted) return null;
  return (
    files.find(
      (file) => words(file.replace(/\.zip$/i, "")).join(" ") === wanted
    ) ?? null
  );
};

export const titleIdOfPack = (file: string) =>
  /\[(0100[0-9a-f]{12})\]/i.exec(file)?.[1]?.toUpperCase() ?? null;

/** Files a mod may carry into the emulator: patches and game data, never programs or scripts. */
export const isSafeModFile = (relativePath: string) =>
  !/\.(exe|dll|bat|cmd|ps1|vbs|js|msi|scr|com|lnk)$/i.test(relativePath) &&
  /(^|[\\/])(exefs|romfs|cheats)[\\/]/i.test(relativePath);

/** Repo file for a title: "[0100…]" in its name, same base title (last 3 hex digits may differ). */
export const matchModPack = (
  files: string[],
  titleId: string
): string | null => {
  const id = titleId.toUpperCase();
  const exact = files.find((file) => file.toUpperCase().includes(`[${id}]`));
  if (exact) return exact;
  const base = id.slice(0, 13);
  return (
    files.find((file) =>
      new RegExp(`\\[${base}[0-9A-F]{3}\\]`, "i").test(file)
    ) ?? null
  );
};
