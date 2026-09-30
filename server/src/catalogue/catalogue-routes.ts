import type { FastifyInstance } from "fastify";
import { genreAliases, normalizeGenre, normalizeGenres } from "./genres.js";
import { db } from "../db.js";
import {
  getOrCacheSteamGame,
  ingestSteamGamesByTitle,
  type SteamGameRow,
} from "./steam-lookup.js";
import { getCuratedNewReleases, getCuratedTopSellers } from "./featured-categories.js";

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function toShopAssets(game: SteamGameRow, downloadSourceIds: string[]) {
  return {
    objectId: String(game.appid),
    shop: "steam",
    title: game.title,
    iconUrl: game.logo_url,
    libraryHeroImageUrl: game.hero_url,
    libraryImageUrl: game.cover_url,
    logoImageUrl: game.logo_url,
    coverImageUrl: game.cover_url,
    downloadSources: downloadSourceIds,
  };
}

function toCatalogueSearchResult(game: SteamGameRow, downloadSourceIds: string[]) {
  return {
    id: String(game.appid),
    objectId: String(game.appid),
    title: game.title,
    shop: "steam",
    genres: normalizeGenres(parseJsonArray(game.genres)),
    developers: parseJsonArray(game.developers),
    publishers: parseJsonArray(game.publishers),
    releaseYear: game.release_year,
    libraryImageUrl: game.cover_url,
    downloadSources: downloadSourceIds,
  };
}

const downloadSourceNamesForGameStatement = db.prepare(
  `SELECT DISTINCT ds.name as name FROM game_repacks gr
   JOIN download_sources ds ON ds.id = gr.download_source_id
   WHERE gr.appid = ?`
);
function downloadSourceIdsForGame(appid: number): string[] {
  const rows = downloadSourceNamesForGameStatement.all(appid) as { name: string | null }[];
  return rows.map((r) => r.name).filter((name): name is string => Boolean(name));
}

/** A random sample of the whole catalogue (independent of download sources) — used for
 * "Surpreenda-me" and as a filler when a curated list doesn't have enough entries cached yet. */
const shuffledGamesStatement = db.prepare(`
  SELECT * FROM steam_games ORDER BY RANDOM() LIMIT ?
`);

/** Games ranked by how many achievements we have cataloged for them, falling back to cache
 * recency for games that tie (most commonly 0, before their achievement list has ever been
 * fetched). Independent of download sources — a game doesn't need a matched repack to show up
 * here, only a cataloged achievement list. */
const mostAchievementsGamesStatement = db.prepare(`
  SELECT sg.*, COUNT(DISTINCT ac.name) as achievement_count
  FROM steam_games sg
  LEFT JOIN achievement_catalogue ac ON ac.shop = 'steam' AND ac.object_id = CAST(sg.appid AS TEXT)
  GROUP BY sg.appid
  ORDER BY achievement_count DESC, sg.cached_at DESC
  LIMIT ?
`);


const distinctFieldStatement = (column: "genres" | "developers" | "publishers") =>
  db.prepare(`SELECT ${column} FROM steam_games WHERE ${column} IS NOT NULL`);

function distinctValues(column: "genres" | "developers" | "publishers"): string[] {
  const rows = distinctFieldStatement(column).all() as Record<string, string>[];
  const values = new Set<string>();
  for (const row of rows)
    for (const v of parseJsonArray(row[column])) values.add(column === "genres" ? normalizeGenre(v) : v);
  return [...values].sort();
}

const similarGamesStatement = db.prepare(`
  SELECT * FROM steam_games
  WHERE appid != ? AND genres LIKE ?
  LIMIT 6
`);

const suggestionsStatement = db.prepare(
  "SELECT DISTINCT title FROM steam_games WHERE title LIKE ? ORDER BY title ASC LIMIT 8"
);

export function registerCatalogueRoutes(app: FastifyInstance) {
  app.get<{
    Params: { shop: string; objectId: string };
    Querystring: { downloadSourceIds?: string };
  }>("/games/:shop/:objectId/download-sources", async (request, reply) => {
    const { shop, objectId } = request.params;
    if (shop !== "steam") return reply.send([]);

    const allowedIds = request.query.downloadSourceIds?.split(",").filter(Boolean);
    const rows = db
      .prepare(
        `SELECT gr.*, ds.name as source_name FROM game_repacks gr
         JOIN download_sources ds ON ds.id = gr.download_source_id
         WHERE gr.appid = ?`
      )
      .all(Number(objectId)) as {
      id: string;
      title: string;
      file_size: string | null;
      uris: string;
      upload_date: string | null;
      download_source_id: string;
      source_name: string | null;
      created_at: string;
    }[];

    const filtered = allowedIds
      ? rows.filter((r) => allowedIds.includes(r.download_source_id))
      : rows;

    reply.send(
      filtered.map((r) => ({
        id: r.id,
        title: r.title,
        fileSize: r.file_size,
        uris: parseJsonArray(r.uris),
        unavailableUris: [],
        uploadDate: r.upload_date,
        downloadSourceId: r.download_source_id,
        downloadSourceName: r.source_name,
        createdAt: r.created_at,
      }))
    );
  });

  app.get<{ Params: { shop: string; objectId: string } }>(
    "/games/:shop/:objectId/stats",
    async (request, reply) => {
      const { shop, objectId } = request.params;
      const { total: downloadCount } = db
        .prepare("SELECT COUNT(*) as total FROM profile_games WHERE shop = ? AND object_id = ?")
        .get(shop, objectId) as { total: number };
      const { total: playerCount } = db
        .prepare(
          "SELECT COUNT(*) as total FROM profile_games WHERE shop = ? AND object_id = ? AND play_time_ms > 0"
        )
        .get(shop, objectId) as { total: number };

      reply.send({ downloadCount, playerCount, averageScore: null, reviewCount: 0 });
    }
  );

  app.post<{ Params: { shop: string; objectId: string } }>(
    "/games/:shop/:objectId/download",
    async (_request, reply) => {
      // Analytics-only signal from the client after a download starts — nothing to persist yet.
      reply.send({ ok: true });
    }
  );

  app.get<{ Params: { shop: string; objectId: string } }>(
    "/games/:shop/:objectId/assets",
    async (request, reply) => {
      const { shop, objectId } = request.params;
      if (shop !== "steam") return reply.code(404).send({ message: "Unknown shop" });

      const appid = Number(objectId);
      const game = await getOrCacheSteamGame(appid);
      if (!game) return reply.code(404).send({ message: "Game not found" });

      reply.send(toShopAssets(game, downloadSourceIdsForGame(appid)));
    }
  );

  app.post<{
    Body: {
      title?: string;
      query?: string;
      take?: number;
      skip?: number;
      shops?: string[];
      genres?: string[];
      publishers?: string[];
      developers?: string[];
      sortBy?: string;
      sortOrder?: string;
      // Kept for backwards compatibility with an earlier client contract that nested
      // these same fields under `data` — the real client sends them at the top level.
      data?: {
        title?: string;
        query?: string;
        take?: number;
        skip?: number;
        shops?: string[];
        genres?: string[];
        publishers?: string[];
        developers?: string[];
        sortBy?: string;
        sortOrder?: string;
      };
    };
  }>("/catalogue/search", async (request, reply) => {
    const body = { ...request.body, ...request.body?.data };
    const term = body.title ?? body.query ?? "";
    const take = body.take ?? 20;
    const skip = body.skip ?? 0;

    // This catalogue only has Steam games matched — a "classics" (launchbox) search has nothing to return.
    if (body.shops && body.shops.length > 0 && !body.shops.includes("steam")) {
      return reply.send({ edges: [], count: 0 });
    }

    // Match each word of the search independently instead of the whole phrase, so punctuation and
    // word order in the stored title don't matter: "Hollow Knight Silksong" still finds
    // "Hollow Knight: Silksong", and "elden ring" finds "ELDEN RING". Each word must appear (AND).
    const titleTokens = term.trim().split(/\s+/).filter(Boolean);
    const conditions: string[] = [];
    const params: string[] = [];
    if (titleTokens.length > 0) {
      for (const token of titleTokens) {
        conditions.push("sg.title LIKE ?");
        params.push(`%${token}%`);
      }
    } else {
      conditions.push("sg.title LIKE ?");
      params.push("%");
    }
    for (const [column, values] of [
      ["genres", body.genres],
      ["publishers", body.publishers],
      ["developers", body.developers],
    ] as const) {
      for (const value of values ?? []) {
        // Genres may be stored in English or Portuguese: match any spelling of the same genre.
        const spellings = column === "genres" ? genreAliases(value) : [value.trim()];
        conditions.push(`(${spellings.map(() => `sg.${column} LIKE ?`).join(" OR ")})`);
        for (const spelling of spellings) {
          params.push(`%${JSON.stringify(spelling).slice(1, -1)}%`);
        }
      }
    }
    const whereClause = conditions.join(" AND ");

    // Map the client's sort choice to a safe ORDER BY built only from fixed strings (no user
    // input reaches the SQL). Popularity uses Steam's review count; games not yet enriched
    // (review_count NULL) sort last so the junk-first alphabetical wall is gone by default.
    const direction = body.sortOrder === "asc" ? "ASC" : "DESC";
    let orderClause: string;
    switch (body.sortBy) {
      case "alphabetical":
        orderClause = `sg.title COLLATE NOCASE ${direction}`;
        break;
      case "releaseDate":
        orderClause = `sg.release_year IS NULL ASC, sg.release_year ${direction}, sg.title COLLATE NOCASE ASC`;
        break;
      // popularity / reviewScore / hydraScore (default) — most reviewed first. Until the
      // background sync backfills review_count for the whole catalogue, games still at NULL fall
      // back to newest-first (not alphabetical), so the default view never leads with "#"/symbol
      // asset-flips.
      default:
        orderClause = `COALESCE(sg.review_count, -1) ${direction}, sg.release_year IS NULL ASC, sg.release_year DESC, sg.title COLLATE NOCASE ASC`;
    }

    const runQuery = () => {
      const games = db
        .prepare(
          `SELECT * FROM steam_games sg
           WHERE ${whereClause} ORDER BY ${orderClause} LIMIT ? OFFSET ?`
        )
        .all(...params, take, skip) as unknown as SteamGameRow[];
      const { total } = db
        .prepare(`SELECT COUNT(*) as total FROM steam_games sg WHERE ${whereClause}`)
        .get(...params) as { total: number };
      return { games, total };
    };

    let { games, total } = runQuery();

    // On-demand ingestion: the background sync only ingests a slice of Steam's ~188k apps, so a
    // known game (Elden Ring, a new release) may not be cached yet. If a title search comes back
    // empty, pull the matches from Steam live, cache them, and retry once so the game shows up now
    // instead of after days. Skipped for filter-only searches (no title to look up on the store).
    const isFilterOnlySearch =
      (body.genres?.length ?? 0) > 0 ||
      (body.publishers?.length ?? 0) > 0 ||
      (body.developers?.length ?? 0) > 0;
    if (total === 0 && term.trim().length >= 2 && !isFilterOnlySearch) {
      const ingested = await ingestSteamGamesByTitle(term).catch(() => 0);
      if (ingested > 0) ({ games, total } = runQuery());
    }

    reply.send({
      edges: games.map((g) => toCatalogueSearchResult(g, downloadSourceIdsForGame(g.appid))),
      count: total,
    });
  });

  app.get<{ Params: { category: string }; Querystring: { take?: string } }>(
    "/catalogue/:category(hot|weekly|achievements)",
    async (request, reply) => {
      const take = Number(request.query.take ?? 12);
      const category = request.params.category;

      let games: SteamGameRow[];
      if (category === "achievements") {
        games = mostAchievementsGamesStatement.all(take) as unknown as SteamGameRow[];
      } else {
        // "hot"/"weekly" use Valve's own curated lists (top sellers / new releases) so these tabs
        // show real popularity signal instead of an arbitrary sample now that the catalogue isn't
        // limited to games with a matched download source. If the curated list hasn't been
        // resolved into steam_games yet (rare — it's fetched on demand), fill the rest randomly
        // so the tab is never emptier than `take`.
        const curated =
          category === "hot" ? await getCuratedTopSellers(take) : await getCuratedNewReleases(take);
        games = curated;
        if (games.length < take) {
          const seen = new Set(games.map((g) => g.appid));
          const fill = (shuffledGamesStatement.all(take - games.length) as unknown as SteamGameRow[])
            .filter((g) => !seen.has(g.appid));
          games = [...games, ...fill];
        }
      }

      reply.send(games.map((g) => toCatalogueSearchResult(g, downloadSourceIdsForGame(g.appid))));
    }
  );

  app.get("/catalogue/featured", async (_request, reply) => {
    const games = shuffledGamesStatement.all(10) as unknown as SteamGameRow[];
    reply.send(
      games.map((g) => ({
        ...toShopAssets(g, downloadSourceIdsForGame(g.appid)),
        description: null,
        uri: `/game/steam/${g.appid}`,
      }))
    );
  });

  app.get("/catalogue/steam/tags", async (_request, reply) => reply.send(distinctValues("genres")));
  app.get("/catalogue/steam/genres", async (_request, reply) => reply.send(distinctValues("genres")));
  app.get("/catalogue/steam/publishers", async (_request, reply) =>
    reply.send(distinctValues("publishers"))
  );
  app.get("/catalogue/steam/developers", async (_request, reply) =>
    reply.send(distinctValues("developers"))
  );

  app.get<{ Params: { shop: string; objectId: string } }>(
    "/catalogue/:shop/:objectId/similar",
    async (request, reply) => {
      const appid = Number(request.params.objectId);
      const game = await getOrCacheSteamGame(appid);
      const firstGenre = parseJsonArray(game?.genres ?? null)[0];
      if (!game || !firstGenre) return reply.send([]);

      const similar = similarGamesStatement.all(appid, `%${firstGenre}%`) as unknown as SteamGameRow[];
      reply.send(similar.map((g) => toCatalogueSearchResult(g, downloadSourceIdsForGame(g.appid))));
    }
  );

  app.get<{ Querystring: { query?: string } }>(
    "/catalogue/search/suggestions",
    async (request, reply) => {
      const term = request.query.query ?? "";
      const rows = suggestionsStatement.all(`${term}%`) as { title: string }[];
      reply.send(rows.map((r) => r.title));
    }
  );

  app.get("/catalogue/filters", async (_request, reply) => reply.send({}));

  // The automatic "scan my Steam folders" feature needs a huge, crowd-sourced
  // executable-name -> appid database we don't have and can't build here. Returning an
  // empty catalog (instead of 404) just stops the client's retry loop from erroring —
  // it doesn't make auto-detection work. Linking an installed copy from a game's own
  // page (which already knows its appid) is the path that actually works.
  app.get("/catalogue/steam/executables", async (_request, reply) => reply.send({}));
}
