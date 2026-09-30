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
}
