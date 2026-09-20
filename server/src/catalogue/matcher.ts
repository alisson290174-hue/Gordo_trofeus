import { getOrCacheSteamGame, searchSteamAppByTitle } from "./steam-lookup.js";

const NOISE_PATTERNS = [
  /\brepack\b/gi,
  /\bgog\b/gi,
  /\bfitgirl\b/gi,
  /\belamigos\b/gi,
  /\bcodex\b/gi,
  /\bplaza\b/gi,
  /\bskidrow\b/gi,
  /\brazor1911\b/gi,
  /\bempress\b/gi,
  /\bcpy\b/gi,
  /\bhoodlum\b/gi,
  /\bmulti\d*\b/gi,
  /\bv\d+(\.\d+)+\b/gi,
  /\bbuild[\s.]?\d+\b/gi,
  /\[[^\]]*\]/g,
  /\([^)]*\)/g,
];

export function normalizeRepackTitle(rawTitle: string): string {
  let title = rawTitle;
  for (const pattern of NOISE_PATTERNS) title = title.replace(pattern, " ");
  return title.replace(/[-_:]/g, " ").replace(/\s+/g, " ").trim();
}

function wordOverlapScore(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(" ").filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / Math.max(wordsA.size, wordsB.size);
}

const MIN_MATCH_SCORE = 0.5;

/** Normalizes a repack title, searches the Steam store, and returns the matched appid if confident enough. */
export async function matchRepackTitleToSteamGame(rawTitle: string): Promise<number | null> {
  const normalized = normalizeRepackTitle(rawTitle);
  if (!normalized) return null;

  const candidate = await searchSteamAppByTitle(normalized);
  if (!candidate) return null;

  const score = wordOverlapScore(normalized, candidate.title);
  if (score < MIN_MATCH_SCORE) return null;

  const cached = await getOrCacheSteamGame(candidate.appid);
  return cached ? candidate.appid : null;
}
