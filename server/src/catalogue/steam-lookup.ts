import { db } from "../db.js";

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
}

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
  name: string;
  genres?: { description: string }[];
  developers?: string[];
  publishers?: string[];
  release_date?: { date: string };
}

async function fetchAppDetails(appid: number): Promise<SteamAppDetails | null> {
  const url = new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids", String(appid));

  const response = await fetch(url).catch(() => null);
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
  INSERT INTO steam_games (appid, title, genres, developers, publishers, cover_url, hero_url, logo_url, release_year, cached_at)
  VALUES ($appid, $title, $genres, $developers, $publishers, $coverUrl, $heroUrl, $logoUrl, $releaseYear, $cachedAt)
  ON CONFLICT(appid) DO UPDATE SET
    title = excluded.title, genres = excluded.genres, developers = excluded.developers,
    publishers = excluded.publishers, cover_url = excluded.cover_url, hero_url = excluded.hero_url,
    logo_url = excluded.logo_url, release_year = excluded.release_year, cached_at = excluded.cached_at
`);

/** Fetches (and caches) full Steam metadata for a known appid. Returns the cached row if already present. */
export async function getOrCacheSteamGame(appid: number): Promise<SteamGameRow | null> {
  const cached = getGameStatement.get(appid) as unknown as SteamGameRow | undefined;
  if (cached) return cached;

  const details = await fetchAppDetails(appid);
  if (!details) return null;

  const { coverUrl, heroUrl, logoUrl } = coverUrlsFor(appid);
  upsertGameStatement.run({
    appid,
    title: details.name,
    genres: JSON.stringify(details.genres?.map((g) => g.description) ?? []),
    developers: JSON.stringify(details.developers ?? []),
    publishers: JSON.stringify(details.publishers ?? []),
    coverUrl,
    heroUrl,
    logoUrl,
    releaseYear: parseReleaseYear(details.release_date?.date),
    cachedAt: new Date().toISOString(),
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
