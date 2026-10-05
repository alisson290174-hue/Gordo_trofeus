/**
 * Steam often names a game with its edition ("… - Definitive Edition", "… GOTY"), while the
 * Xbox app / Epic / a folder calls it just "…". Both titles arrive already normalized
 * (lowercase, words separated by single spaces). Only edition words may follow the wanted
 * title; anything else ("2", "remake", a subtitle) is a different game.
 */
const EDITION_WORDS = new Set([
  "definitive",
  "deluxe",
  "complete",
  "ultimate",
  "enhanced",
  "gold",
  "standard",
  "special",
  "anniversary",
  "goty",
  "game",
  "of",
  "the",
  "year",
  "edition",
  "director",
  "directors",
  "cut",
]);

export function isEditionOf(candidate: string, wanted: string) {
  if (!candidate.startsWith(`${wanted} `)) return false;
  const rest = candidate.slice(wanted.length + 1).split(" ");
  return (
    rest.length > 0 &&
    rest.every((word) => EDITION_WORDS.has(word)) &&
    // A real edition name, not just "the" or "of".
    rest.some((word) => word === "edition" || word === "goty" || word === "cut")
  );
}
