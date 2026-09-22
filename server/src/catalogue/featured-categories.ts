import { getOrCacheSteamGame, type SteamGameRow } from "./steam-lookup.js";

interface FeaturedCategoriesResponse {
  top_sellers?: { items?: { id: number }[] };
  new_releases?: { items?: { id: number }[] };
}

interface FeaturedCache {
  topSellers: number[];
  newReleases: number[];
  fetchedAt: number;
}

let cache: FeaturedCache | null = null;
const CACHE_TTL_MS = 60 * 60_000; // Valve's own curated lists don't change minute to minute.

async function fetchFeaturedCategories(): Promise<FeaturedCache> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;

  try {
    const response = await fetch(
      "https://store.steampowered.com/api/featuredcategories?cc=us&l=english",
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as FeaturedCategoriesResponse;
    cache = {
      topSellers: (data.top_sellers?.items ?? []).map((item) => item.id),
      newReleases: (data.new_releases?.items ?? []).map((item) => item.id),
      fetchedAt: Date.now(),
    };
  } catch {
    // Keep serving a stale cache rather than failing the request — callers already fall back to
    // a random sample when the curated list comes back empty.
    if (!cache) cache = { topSellers: [], newReleases: [], fetchedAt: Date.now() };
  }

  return cache;
}

/** Resolves a curated appid list to real cached rows, fetching any Valve hasn't had cached yet —
 * these are hand-picked by Steam, so they're worth an on-demand fetch ahead of the background sync. */
async function resolveGames(appids: number[], take: number): Promise<SteamGameRow[]> {
  const games: SteamGameRow[] = [];
  for (const appid of appids) {
    if (games.length >= take) break;
    const game = await getOrCacheSteamGame(appid);
    if (game) games.push(game);
  }
  return games;
}

export async function getCuratedTopSellers(take: number): Promise<SteamGameRow[]> {
  const { topSellers } = await fetchFeaturedCategories();
  return resolveGames(topSellers, take);
}

export async function getCuratedNewReleases(take: number): Promise<SteamGameRow[]> {
  const { newReleases } = await fetchFeaturedCategories();
  return resolveGames(newReleases, take);
}
