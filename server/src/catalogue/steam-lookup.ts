import { db } from "../db.js";
import { normalizeGenres } from "./genres.js";

export interface SteamGameRow {
  appid: number;
  title: string;
  genres: string | null;
  developers: string | null;
  publishers: string | null;
  cover_url: string | null;
  hero_url: string | null;
  logo_url: string | null;
  release_year: number | null;
  cached_at: string;
  lang: string | null;
  review_count: number | null;
}

// Games cached before Portuguese support was added have lang = NULL — treating that as stale
// forces a one-time re-fetch (in Portuguese) the next time each one is touched, without needing
// to wipe and rebuild the whole catalogue.
const CATALOGUE_LANG = "brazilian";

interface SteamSearchItem {
  id: number;
  name: string;
  type: string;
}

async function searchStoreByTitle(title: string): Promise<SteamSearchItem[]> {
  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.searchParams.set("term", title);
  url.searchParams.set("cc", "us");
  url.searchParams.set("l", "english");

  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return [];

  const data = (await response.json().catch(() => null)) as { items?: SteamSearchItem[] } | null;
  return (data?.items ?? []).filter((item) => item.type === "app");
}

interface SteamAppDetails {
  type?: string;
  name: string;
  genres?: { description: string }[];
  developers?: string[];
  publishers?: string[];
  release_date?: { date: string };
  recommendations?: { total?: number };
}

async function fetchAppDetails(appid: number): Promise<SteamAppDetails | null> {
  const url = new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids", String(appid));
  url.searchParams.set("l", CATALOGUE_LANG);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return null;

  const data = (await response.json().catch(() => null)) as Record<
    string,
    { success: boolean; data?: SteamAppDetails }
  > | null;
  return data?.[String(appid)]?.data ?? null;
}

function coverUrlsFor(appid: number) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`;
  return {
    coverUrl: `${base}/library_600x900.jpg`,
    heroUrl: `${base}/library_hero.jpg`,
    logoUrl: `${base}/logo.png`,
  };
}

function parseReleaseYear(dateString?: string): number | null {
  const match = dateString?.match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

const getGameStatement = db.prepare("SELECT * FROM steam_games WHERE appid = ?");
const upsertGameStatement = db.prepare(`
  INSERT INTO steam_games (appid, title, genres, developers, publishers, cover_url, hero_url, logo_url, release_year, cached_at, lang, review_count)
  VALUES ($appid, $title, $genres, $developers, $publishers, $coverUrl, $heroUrl, $logoUrl, $releaseYear, $cachedAt, $lang, $reviewCount)
  ON CONFLICT(appid) DO UPDATE SET
    title = excluded.title, genres = excluded.genres, developers = excluded.developers,
    publishers = excluded.publishers, cover_url = excluded.cover_url, hero_url = excluded.hero_url,
    logo_url = excluded.logo_url, release_year = excluded.release_year, cached_at = excluded.cached_at,
    lang = excluded.lang, review_count = excluded.review_count
`);

/** Fetches (and caches) full Steam metadata for a known appid. Returns the cached row if already
 * present in the current catalogue language; re-fetches if it was cached before Portuguese
 * support existed (lang IS NULL). */
export async function getOrCacheSteamGame(appid: number): Promise<SteamGameRow | null> {
  const cached = getGameStatement.get(appid) as unknown as SteamGameRow | undefined;
  // Re-fetch when cached before Portuguese support (lang stale) OR before review_count existed
  // (null) — so ordering the catalogue by popularity backfills a game the moment it's touched.
  if (cached && cached.lang === CATALOGUE_LANG && cached.review_count != null)
    return cached;

  const details = await fetchAppDetails(appid);
  // The store also lists DLC, demos, software, soundtracks, etc. under the same appdetails
  // endpoint — only "game" entries belong in the catalogue.
  if (!details || (details.type && details.type !== "game")) return cached ?? null;

  const { coverUrl, heroUrl, logoUrl } = coverUrlsFor(appid);
  upsertGameStatement.run({
    appid,
    title: details.name,
    genres: JSON.stringify(normalizeGenres(details.genres?.map((g) => g.description) ?? [])),
    developers: JSON.stringify(details.developers ?? []),
    publishers: JSON.stringify(details.publishers ?? []),
    coverUrl,
    heroUrl,
    logoUrl,
    releaseYear: parseReleaseYear(details.release_date?.date),
    cachedAt: new Date().toISOString(),
    lang: CATALOGUE_LANG,
    // Store 0 (not null) when Steam reports no recommendations, so we don't re-fetch it forever.
    reviewCount: details.recommendations?.total ?? 0,
  });

  return getGameStatement.get(appid) as unknown as SteamGameRow;
}

/** Searches the Steam store by title, without caching — used by the download-source matcher. */
export async function searchSteamAppByTitle(
  title: string
): Promise<{ appid: number; title: string } | null> {
  const results = await searchStoreByTitle(title);
  const best = results[0];
  return best ? { appid: best.id, title: best.name } : null;
}

// Avoid hammering Steam when the same missing term is searched repeatedly (e.g. a user typing).
const recentIngestTerms = new Map<string, number>();
const INGEST_TERM_TTL_MS = 10 * 60 * 1000;

/**
 * On-demand catalogue ingestion: when a title search finds nothing locally (the background sync
 * hasn't reached that game yet), pull the matching games from the Steam store live and cache them
 * so they show up immediately instead of after days of sequential ingestion.
 */
export async function ingestSteamGamesByTitle(
  title: string,
  limit = 12
): Promise<number> {
  const key = title.trim().toLowerCase();
  if (!key) return 0;

  const last = recentIngestTerms.get(key);
  if (last && Date.now() - last < INGEST_TERM_TTL_MS) return 0;
  recentIngestTerms.set(key, Date.now());
  // keep the map small
  if (recentIngestTerms.size > 500) {
    for (const [k, t] of recentIngestTerms) {
      if (Date.now() - t > INGEST_TERM_TTL_MS) recentIngestTerms.delete(k);
    }
  }

  const results = await searchStoreByTitle(title);
  const appids = [...new Set(results.slice(0, limit).map((item) => item.id))];

  const CONCURRENCY = 3;
  let ingested = 0;
  for (let i = 0; i < appids.length; i += CONCURRENCY) {
    const batch = appids.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(
      batch.map((appid) => getOrCacheSteamGame(appid).catch(() => null))
    );
    ingested += rows.filter(Boolean).length;
  }
  return ingested;
}
