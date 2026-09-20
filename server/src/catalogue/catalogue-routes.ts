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

const downloadSourceIdsForGameStatement = db.prepare(
  "SELECT DISTINCT download_source_id FROM game_repacks WHERE appid = ?"
);
function downloadSourceIdsForGame(appid: number): string[] {
  const rows = downloadSourceIdsForGameStatement.all(appid) as { download_source_id: string }[];
  return rows.map((r) => r.download_source_id);
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

const searchGamesStatement = db.prepare(`
  SELECT DISTINCT sg.*
  FROM steam_games sg
  JOIN game_repacks gr ON gr.appid = sg.appid
  WHERE sg.title LIKE ?
  ORDER BY sg.title ASC
  LIMIT ? OFFSET ?
`);
const countSearchGamesStatement = db.prepare(`
  SELECT COUNT(DISTINCT sg.appid) as total
  FROM steam_games sg
  JOIN game_repacks gr ON gr.appid = sg.appid
  WHERE sg.title LIKE ?
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
    Body: { data?: { title?: string; query?: string; take?: number; skip?: number } };
  }>("/catalogue/search", async (request, reply) => {
    const data = request.body?.data ?? {};
    const term = data.title ?? data.query ?? "";
    const take = data.take ?? 20;
    const skip = data.skip ?? 0;
    const likeTerm = `%${term}%`;

    const games = searchGamesStatement.all(likeTerm, take, skip) as unknown as SteamGameRow[];
    const { total } = countSearchGamesStatement.get(likeTerm) as { total: number };

    reply.send({
      edges: games.map((g) => toCatalogueSearchResult(g, downloadSourceIdsForGame(g.appid))),
      count: total,
    });
  });

  app.get<{ Querystring: { take?: string } }>(
    "/catalogue/:category(hot|weekly|achievements)",
    async (request, reply) => {
      const take = Number(request.query.take ?? 12);
      const games = recentGamesStatement.all(take) as unknown as SteamGameRow[];
      reply.send(games.map((g) => toCatalogueSearchResult(g, downloadSourceIdsForGame(g.appid))));
    }
  );

  app.get("/catalogue/featured", async (_request, reply) => {
    const games = recentGamesStatement.all(10) as unknown as SteamGameRow[];
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
}
