import fs from "node:fs";
import path from "node:path";

/** Pure matching logic of the installed-game finder (no app state — unit tested). */
export interface UninstallEntry {
  key: string;
  name: string;
  location: string | null;
  icon: string | null;
}

const normalize = (value: string) =>
  value
    // Before NFKD, which would turn "™" into the letters "TM" ("Dogs™" → "dogstm").
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const STOP_WORDS = new Set([
  "the",
  "of",
  "and",
  "a",
  "edition",
  "definitive",
  "remastered",
  "goty",
]);
const significantWords = (value: string) =>
  normalize(value)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

/** Share of the game's significant words present in the installed program's name (0–1). */
export function titleMatchScore(gameTitle: string, programName: string) {
  const wanted = significantWords(gameTitle);
  if (wanted.length === 0) return 0;
  const have = new Set(significantWords(programName));
  return wanted.filter((word) => have.has(word)).length / wanted.length;
}

const IGNORED_EXECUTABLE =
  /unins|uninstall|setup|install|redist|vc_?redist|dxsetup|directx|prereq|crash|report|update|helper|easyanticheat|start_protected_game|battleye|dotnet|vcredist|ue4prereq|cefprocess|webhelper|vconsole|console|editor|dedicated|server|benchmark|config|settings|sdk|debug/i;

/** "Counter-Strike 2" → "cs2": games often ship an executable named by their initials. */
const initials = (title: string) =>
  normalize(title)
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word))
    .map((word) => (/^\d+$/.test(word) ? word : word[0]))
    .join("");

/** How well an executable's file name fits the game (0–1): shared words, or the title's initials. */
const executableNameScore = (gameTitle: string, fileName: string) => {
  const byWords = titleMatchScore(gameTitle, fileName);
  if (byWords > 0) return byWords;
  const compact = normalize(fileName).replace(/ /g, "");
  const abbreviation = initials(gameTitle);
  return abbreviation.length >= 2 && compact === abbreviation ? 1 : 0;
};

const iconExecutable = (icon: string | null) => {
  if (!icon) return null;
  const candidate = icon
    .replace(/^"/, "")
    .replace(/"?,\s*-?\d+$/, "")
    .replace(/"$/, "");
  return candidate.toLowerCase().endsWith(".exe") ? candidate : null;
};

function listExecutables(directory: string, depth = 0): string[] {
  if (depth > 3) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return listExecutables(full, depth + 1);
    return entry.name.toLowerCase().endsWith(".exe") ? [full] : [];
  });
}

/** The game's executable inside its install folder: the registered icon, else the best-named exe. */
export function pickGameExecutable(
  gameTitle: string,
  entry: UninstallEntry
): string | null {
  const fromIcon = iconExecutable(entry.icon);
  if (
    fromIcon &&
    fs.existsSync(fromIcon) &&
    !IGNORED_EXECUTABLE.test(path.basename(fromIcon))
  ) {
    return fromIcon;
  }

  const folder =
    entry.location && fs.existsSync(entry.location)
      ? entry.location
      : fromIcon && fs.existsSync(path.dirname(fromIcon))
        ? path.dirname(fromIcon)
        : null;
  if (!folder) return null;

  const candidates = listExecutables(folder).filter(
    (file) => !IGNORED_EXECUTABLE.test(path.basename(file))
  );
  if (candidates.length === 0) return null;

  const scored = candidates.map((file) => {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      /* unreadable — keep 0 */
    }
    const depth = path.relative(folder, file).split(path.sep).length;
    return {
      file,
      name: executableNameScore(gameTitle, path.basename(file, ".exe")),
      depth,
      size,
    };
  });
  scored.sort(
    (a, b) => b.name - a.name || a.depth - b.depth || b.size - a.size
  );
  return scored[0].file;
}

export const MATCH_THRESHOLD = 0.6;

/** Best uninstall entry for a game title, or null when nothing is a confident match. */
export function findEntryForGame(gameTitle: string, entries: UninstallEntry[]) {
  const ranked = entries
    .map((entry) => ({ entry, score: titleMatchScore(gameTitle, entry.name) }))
    .filter(({ score }) => score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.entry ?? null;
}
