import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/require-auth.js";
import { config } from "../config.js";

/**
 * Games the signed-in user owns on Steam. Uses the Steam ID from the Steam sign-in and the
 * server's own Steam Web API key — the client never needs a Steam password or key. The key stays
 * on the server; only the list (appid, name, playtime) goes back to the user who owns it.
 */
interface SteamOwnedGame {
  appid: number;
  name?: string;
  playtime_forever?: number;
  rtime_last_played?: number;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

export function registerSteamOwnedRoutes(app: FastifyInstance) {
  app.get("/profile/steam/owned-games", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const cached = cache.get(user.id);
    if (cached && Date.now() - cached.at < CACHE_MS) return reply.send(cached.body);

    const url = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
    url.searchParams.set("key", config.steamApiKey);
    url.searchParams.set("steamid", user.steam_id);
    url.searchParams.set("include_appinfo", "1");
    url.searchParams.set("include_played_free_games", "1");
    url.searchParams.set("format", "json");

    const response = await fetch(url).catch(() => null);
    if (!response?.ok) {
      return reply.code(502).send({ message: "Steam is unavailable right now" });
    }

    const data = (await response.json()) as {
      response?: { game_count?: number; games?: SteamOwnedGame[] };
    };
    const games = data.response?.games;

    // Steam returns an empty object when the profile's game details are private.
    const body = {
      visible: Array.isArray(games),
      games: (games ?? []).map((game) => ({
        appId: String(game.appid),
        title: game.name ?? String(game.appid),
        playtimeMinutes: game.playtime_forever ?? 0,
        lastPlayedAt: game.rtime_last_played ? game.rtime_last_played * 1000 : null,
      })),
    };

    cache.set(user.id, { at: Date.now(), body });
    reply.send(body);
  });

  /**
   * Achievements the signed-in user unlocked in their Steam games (official Steam, not files on
   * disk). Only ever for the caller's own Steam ID; needs "Game details" public on the Steam
   * profile. Answers `{ visible, games: { [appId]: [{ name, unlockTime }] } }` — games without
   * achievements are simply left out.
   */
  app.post<{ Body: { appIds?: unknown } }>(
    "/profile/steam/achievements",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const appIds = Array.isArray(request.body?.appIds)
        ? [...new Set(request.body.appIds.map(String))].filter((id) => /^\d{1,10}$/.test(id))
        : [];
      if (appIds.length === 0 || appIds.length > MAX_ACHIEVEMENT_APPS) {
        return reply.code(400).send({ message: `Send 1 to ${MAX_ACHIEVEMENT_APPS} app ids` });
      }

      const games: Record<string, SteamUnlock[]> = {};
      let denied = 0;

      // A few at a time — plenty fast for a library, gentle on Steam's rate limit.
      for (let i = 0; i < appIds.length; i += 4) {
        const results = await Promise.all(
          appIds.slice(i, i + 4).map((appId) => getPlayerAchievements(user.id, user.steam_id, appId))
        );
        results.forEach((result, index) => {
          if (result === "private") denied += 1;
          else if (result) games[appIds[i + index]] = result;
        });
      }

      // Steam also answers 403 for single games (delisted, test apps), so the profile only counts
      // as private when every game asked came back denied.
      const visible = denied < appIds.length;
      request.log.info({ asked: appIds.length, withAchievements: Object.keys(games).length, denied }, "steam achievements");
      reply.send({ visible, games });
    }
  );
}

const MAX_ACHIEVEMENT_APPS = 25;
const ACHIEVEMENTS_CACHE_MS = 5 * 60 * 1000;
const achievementsCache = new Map<string, { at: number; unlocks: SteamUnlock[] | null }>();

interface SteamUnlock {
  name: string;
  unlockTime: number;
}

/** Unlocked achievements, null when the game has none, "private" when Steam hides them. */
async function getPlayerAchievements(
  userId: string,
  steamId: string,
  appId: string
): Promise<SteamUnlock[] | null | "private"> {
  const cacheKey = `${userId}:${appId}`;
  const cached = achievementsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ACHIEVEMENTS_CACHE_MS) return cached.unlocks;

  const url = new URL("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/");
  url.searchParams.set("key", config.steamApiKey);
  url.searchParams.set("steamid", steamId);
  url.searchParams.set("appid", appId);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response) return null;
  // 403 = the profile's game details are private; 400 = the game has no achievements/stats.
  if (response.status === 403) {
    achievementsCache.set(cacheKey, { at: Date.now(), unlocks: null });
    return "private";
  }
  if (!response.ok) {
    if (response.status === 400) achievementsCache.set(cacheKey, { at: Date.now(), unlocks: null });
    return null;
  }

  const data = (await response.json().catch(() => null)) as {
    playerstats?: {
      success?: boolean;
      achievements?: { apiname: string; achieved: number; unlocktime: number }[];
    };
  } | null;
  if (!data?.playerstats?.success) return null;

  const unlocks = (data.playerstats.achievements ?? [])
    .filter((achievement) => achievement.achieved === 1)
    .map((achievement) => ({
      name: achievement.apiname,
      // Steam gives seconds; 0 happens for very old unlocks — keep them, dated "now".
      unlockTime: achievement.unlocktime > 0 ? achievement.unlocktime * 1000 : Date.now(),
    }));

  achievementsCache.set(cacheKey, { at: Date.now(), unlocks });
  return unlocks;
}
