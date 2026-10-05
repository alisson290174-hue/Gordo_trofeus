import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";

export interface ProfileGameRow {
  id: string;
  user_id: string;
  shop: string;
  object_id: string;
  play_time_ms: number;
  last_time_played: string | null;
  is_favorite: number;
  is_pinned: number;
  created_at: string;
}

const findGameStatement = db.prepare(
  "SELECT * FROM profile_games WHERE user_id = ? AND shop = ? AND object_id = ?"
);
const insertGameStatement = db.prepare(`
  INSERT INTO profile_games (id, user_id, shop, object_id, play_time_ms, last_time_played, created_at)
  VALUES ($id, $userId, $shop, $objectId, $playTimeMs, $lastTimePlayed, $createdAt)
`);
const bumpPlaytimeStatement = db.prepare(
  "UPDATE profile_games SET play_time_ms = play_time_ms + ?, last_time_played = ? WHERE id = ?"
);
const listGamesStatement = db.prepare(
  "SELECT * FROM profile_games WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
);

/** Upsert semantics: reusing the existing row (not creating a duplicate) is what keeps achievement
 * history attached to the same profile_game_id after e.g. a reinstall re-adds the same game. */
export function upsertProfileGame(
  userId: string,
  shop: string,
  objectId: string,
  playTimeInMilliseconds: number,
  lastTimePlayed: string | null
): ProfileGameRow {
  const existing = findGameStatement.get(userId, shop, objectId) as ProfileGameRow | undefined;
  if (existing) return existing;

  const id = crypto.randomUUID();
  insertGameStatement.run({
    id,
    userId,
    shop,
    objectId,
    playTimeMs: Math.trunc(playTimeInMilliseconds),
    lastTimePlayed,
    createdAt: new Date().toISOString(),
  });
  return findGameStatement.get(userId, shop, objectId) as unknown as ProfileGameRow;
}

// Offline trophies only — the same set the platinum is measured against.
const achievementCountStatement = db.prepare(
  "SELECT COUNT(*) AS total FROM achievement_catalogue WHERE shop = ? AND object_id = ? AND is_online = 0"
);
// Unlocks of offline trophies only (online ones unlocked in e.g. Red Dead Online used to push RDR2
// to "34 of 34" while its offline list showed 27). Games without a cached catalogue count all.
const unlockedCountStatement = db.prepare(
  `SELECT COUNT(*) AS total FROM user_achievements ua
   JOIN profile_games pg ON pg.id = ua.profile_game_id
   WHERE ua.profile_game_id = ?
     AND (
       NOT EXISTS (SELECT 1 FROM achievement_catalogue c WHERE c.shop = pg.shop AND c.object_id = pg.object_id)
       OR EXISTS (
         SELECT 1 FROM achievement_catalogue c
         WHERE c.shop = pg.shop AND c.object_id = pg.object_id
           AND c.name = ua.achievement_name COLLATE NOCASE AND COALESCE(c.is_online, 0) = 0
       )
     )`
);

function toProfileGame(row: ProfileGameRow) {
  const { total: achievementCount } = achievementCountStatement.get(row.shop, row.object_id) as {
    total: number;
  };
  const { total: unlocked } = unlockedCountStatement.get(row.id) as { total: number };
  return {
    // Lets the library flag games that can be platinumed before their page is ever opened.
    achievementCount,
    unlockedAchievementCount: Math.min(unlocked, achievementCount),
    id: row.id,
    shop: row.shop,
    objectId: row.object_id,
    playTimeInMilliseconds: row.play_time_ms,
    lastTimePlayed: row.last_time_played,
    isFavorite: Boolean(row.is_favorite),
    isPinned: Boolean(row.is_pinned),
    createdAt: row.created_at,
  };
}

export function registerLibraryRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      objectId: string;
      shop: string;
      playTimeInMilliseconds?: number;
      lastTimePlayed?: string | null;
    };
  }>("/profile/games", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { objectId, shop, playTimeInMilliseconds, lastTimePlayed } = request.body;
    const game = upsertProfileGame(
      user.id,
      shop,
      objectId,
      playTimeInMilliseconds ?? 0,
      lastTimePlayed ?? null
    );
    reply.send(toProfileGame(game));
  });

  app.post<{
    Body: {
      objectId: string;
      shop: string;
      playTimeInMilliseconds?: number;
      lastTimePlayed?: string | null;
    }[];
  }>("/profile/games/batch", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const games = (request.body ?? []).map((entry) =>
      toProfileGame(
        upsertProfileGame(
          user.id,
          entry.shop,
          entry.objectId,
          entry.playTimeInMilliseconds ?? 0,
          entry.lastTimePlayed ?? null
        )
      )
    );
    reply.send(games);
  });

  app.put<{
    Params: { shop: string; objectId: string };
    Body: { playTimeDeltaInSeconds?: number; lastTimePlayed?: string | null };
  }>("/profile/games/:shop/:objectId", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { shop, objectId } = request.params;
    const game = upsertProfileGame(user.id, shop, objectId, 0, null);

    const deltaMs = (request.body.playTimeDeltaInSeconds ?? 0) * 1000;
    bumpPlaytimeStatement.run(deltaMs, request.body.lastTimePlayed ?? null, game.id);

    reply.send(toProfileGame(findGameStatement.get(user.id, shop, objectId) as unknown as ProfileGameRow));
  });

  app.get<{ Querystring: { take?: string; skip?: string } }>(
    "/profile/games",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const take = Number(request.query.take ?? 100);
      const skip = Number(request.query.skip ?? 0);
      const games = listGamesStatement.all(user.id, take, skip) as unknown as ProfileGameRow[];
      reply.send(games.map(toProfileGame));
    }
  );
}
