/** Pure rules of the folder game finder (no app state — unit tested). */

// Release/repack noise that is never part of a game's name.
const NOISE_WORDS =
  /\b(repack|fitgirl|dodi|elamigos|kaos|gog|steamrip|onlinefix|online fix|portable|multi\d*|x64|x86|win64|win32|pc|build \d+|update \d+|hotfix|codex|plaza|skidrow|rune|tenoke|empress|flt|razor1911|insaneramzes|chronos|darksiders|tinyiso)\b/gi;

/** "Turnip Boy CommitsTaxEvad" → "Turnip Boy Commits Tax Evad". */
const splitCamelCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

/**
 * Best guess of a game's name from its folder: "Dome.Keeper.v5.0.8" → "Dome Keeper",
 * "CONTROL.Resonant-InsaneRamZes" → "CONTROL Resonant", "DeathStranding" → "Death Stranding".
 */
export function cleanFolderTitle(folderName: string) {
  let title = folderName
    .replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, " ")
    // Scene-style "Game.Name-GROUP": the part after the last dash is the group.
    .replace(/-[A-Za-z0-9]+$/, (group) =>
      /[A-Z]/.test(group.slice(1)) && !/\s/.test(group) ? " " : group
    )
    .replace(/[._]+/g, " ")
    // Versions: v5.0.8, v1 2 3 (dots already turned into spaces), 1.0.2.
    .replace(/\bv\s?\d+(\s\d+)*\b/gi, " ")
    .replace(/\b\d+(\s\d+){2,}\b/g, " ");

  title = splitCamelCase(title).replace(NOISE_WORDS, " ");
  return title.replace(/\s+/g, " ").trim();
}

// Edition names the store adds that a folder rarely carries ("DEATH STRANDING DIRECTOR'S CUT").
const EDITION_WORDS =
  /\b(director'?s cut|definitive|complete|game of the year|goty|deluxe|remastered|enhanced|anniversary|ultimate|gold|edition)\b/gi;

const words = (value: string) =>
  value
    .replace(/[™®©]/g, "")
    .replace(EDITION_WORDS, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && word !== "the" && word !== "of");

/** Share of `wanted`'s words found in `have`; `wanted`'s last word may be cut short (a prefix). */
const coverage = (wanted: string[], have: string[], lastMayBeCut: boolean) => {
  if (wanted.length === 0) return 0;
  const found = wanted.filter((word, index) =>
    lastMayBeCut && index === wanted.length - 1
      ? have.some((other) => other.startsWith(word))
      : have.includes(word)
  );
  return found.length / wanted.length;
};

/**
 * Whether a Steam store result is the game in the folder: most words have to agree both ways, so
 * a short or generic folder ("Hydra", "Tools") never pulls in a random game that merely contains it.
 * Folder names cut short ("…Tax Evad") still match their last word as a prefix.
 */
export function isConfidentTitleMatch(folderTitle: string, steamTitle: string) {
  const folder = words(folderTitle);
  const steam = words(steamTitle);
  if (folder.length === 0 || steam.length === 0) return false;
  const steamCovered = steam.filter(
    (word) =>
      folder.includes(word) ||
      folder.some(
        (other, index) => index === folder.length - 1 && word.startsWith(other)
      )
  ).length;
  return (
    coverage(folder, steam, true) >= 0.75 && steamCovered / steam.length >= 0.75
  );
}

/** Searches to try for a folder title: as is, then without its (possibly cut) last word. */
export function searchTermsFor(folderTitle: string) {
  const terms = [folderTitle];
  const shorter = folderTitle.split(" ").slice(0, -1).join(" ");
  if (shorter.split(" ").length >= 2) terms.push(shorter);
  return terms;
}

/** Folders never treated as a game (tools, dev projects, installers kept around). */
export const IGNORED_FOLDER =
  /^(\$|\.|_)|installer|instalador|setup|redist|backup|tools?$|sdk|node_modules|crack|patch|update|mods?$|saves?$|^(steam|steamlibrary|steamapps|epic games|gog galaxy|xboxgames|origin games|ubisoft game launcher)$/i;
