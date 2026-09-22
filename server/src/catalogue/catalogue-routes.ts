import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { getOrCacheSteamGame, type SteamGameRow } from "./steam-lookup.js";

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
    genres: parseJsonArray(game.genres),
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

/** Games that have at least one matched repack, most recently added first. */
const recentGamesStatement = db.prepare(`
  SELECT sg.*, MAX(gr.created_at) as latest_repack_at
  FROM steam_games sg
  JOIN game_repacks gr ON gr.appid = sg.appid
  GROUP BY sg.appid
  ORDER BY latest_repack_at DESC
  LIMIT ?
`);

/** A shuffled sample of the catalogue — different from "hot" so the home tabs don't all show the
 * same handful of games (the pool is randomized per request, not per-user). */
const shuffledGamesStatement = db.prepare(`
  SELECT sg.*
  FROM steam_games sg
  JOIN game_repacks gr ON gr.appid = sg.appid
  GROUP BY sg.appid
  ORDER BY RANDOM()
  LIMIT ?
`);

/** Games ranked by how many achievements we have cataloged for them, falling back to recency for
 * games that tie (most commonly 0, before their achievement list has ever been fetched). */
const mostAchievementsGamesStatement = db.prepare(`
  SELECT sg.*, COUNT(DISTINCT ac.name) as achievement_count, MAX(gr.created_at) as latest_repack_at
  FROM steam_games sg
  JOIN game_repacks gr ON gr.appid = sg.appid
  LEFT JOIN achievement_catalogue ac ON ac.shop = 'steam' AND ac.object_id = CAST(sg.appid AS TEXT)
  GROUP BY sg.appid
  ORDER BY achievement_count DESC, latest_repack_at DESC
  LIMIT ?
`);


const distinctFieldStatement = (column: "genres" | "developers" | "publishers") =>
  db.prepare(`SELECT ${column} FROM steam_games WHERE ${column} IS NOT NULL`);

function distinctValues(column: "genres" | "developers" | "publishers"): string[] {
  const rows = distinctFieldStatement(column).all() as Record<string, string>[];
  const values = new Set<string>();
  for (const row of rows) for (const v of parseJsonArray(row[column])) values.add(v);
  return [...values].sort();
}

const similarGamesStatement = db.prepare(`
  SELECT DISTINCT sg.*
  FROM steam_games sg
  JOIN game_repacks gr ON gr.appid = sg.appid
  WHERE sg.appid != ? AND sg.genres LIKE ?
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
      };
    };
  }>("/catalogue/search", async (request, reply) => {
    const body = { ...request.body, ...request.body?.data };
    const term = body.title ?? body.query ?? "";
    const take = body.take ?? 20;
    const skip = body.skip ?? 0;
    const likeTerm = `%${term}%`;

    // This catalogue only has Steam games matched — a "classics" (launchbox) search has nothing to return.
    if (body.shops && body.shops.length > 0 && !body.shops.includes("steam")) {
      return reply.send({ edges: [], count: 0 });
    }

    const conditions = ["sg.title LIKE ?"];
    const params: string[] = [likeTerm];
    for (const [column, values] of [
      ["genres", body.genres],
      ["publishers", body.publishers],
      ["developers", body.developers],
    ] as const) {
      for (const value of values ?? []) {
        conditions.push(`sg.${column} LIKE ?`);
        params.push(`%${JSON.stringify(value.trim()).slice(1, -1)}%`);
      }
    }
    const whereClause = conditions.join(" AND ");

    const games = db
      .prepare(
        `SELECT DISTINCT sg.* FROM steam_games sg JOIN game_repacks gr ON gr.appid = sg.appid
         WHERE ${whereClause} ORDER BY sg.title ASC LIMIT ? OFFSET ?`
      )
      .all(...params, take, skip) as unknown as SteamGameRow[];
    const { total } = db
      .prepare(
        `SELECT COUNT(DISTINCT sg.appid) as total FROM steam_games sg JOIN game_repacks gr ON gr.appid = sg.appid
         WHERE ${whereClause}`
      )
      .get(...params) as { total: number };

    reply.send({
      edges: games.map((g) => toCatalogueSearchResult(g, downloadSourceIdsForGame(g.appid))),
      count: total,
    });
  });

  app.get<{ Params: { category: string }; Querystring: { take?: string } }>(
    "/catalogue/:category(hot|weekly|achievements)",
    async (request, reply) => {
      const take = Number(request.query.take ?? 12);
      const statement =
        request.params.category === "achievements"
          ? mostAchievementsGamesStatement
          : request.params.category === "weekly"
            ? shuffledGamesStatement
            : recentGamesStatement;
      const games = statement.all(take) as unknown as SteamGameRow[];
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
