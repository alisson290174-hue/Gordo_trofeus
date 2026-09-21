import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";

interface GameCollectionRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

const listCollectionsStatement = db.prepare(
  `SELECT gc.*, COUNT(gci.profile_game_id) as games_count
   FROM game_collections gc
   LEFT JOIN game_collection_items gci ON gci.collection_id = gc.id
   WHERE gc.user_id = ?
   GROUP BY gc.id
   ORDER BY gc.created_at ASC`
);
const getCollectionStatement = db.prepare(
  "SELECT * FROM game_collections WHERE id = ? AND user_id = ?"
);
const insertCollectionStatement = db.prepare(
  "INSERT INTO game_collections (id, user_id, name, created_at) VALUES ($id, $userId, $name, $createdAt)"
);
const renameCollectionStatement = db.prepare(
  "UPDATE game_collections SET name = ? WHERE id = ? AND user_id = ?"
);
const deleteCollectionItemsStatement = db.prepare(
  "DELETE FROM game_collection_items WHERE collection_id = ?"
);
const deleteCollectionStatement = db.prepare(
  "DELETE FROM game_collections WHERE id = ? AND user_id = ?"
);
const countCollectionGamesStatement = db.prepare(
  "SELECT COUNT(*) as total FROM game_collection_items WHERE collection_id = ?"
);
const findProfileGameStatement = db.prepare(
  "SELECT id FROM profile_games WHERE user_id = ? AND shop = ? AND object_id = ?"
);
const deleteItemsForGameStatement = db.prepare(
  `DELETE FROM game_collection_items
   WHERE profile_game_id = ?
     AND collection_id IN (SELECT id FROM game_collections WHERE user_id = ?)`
);
const insertItemStatement = db.prepare(
  `INSERT INTO game_collection_items (collection_id, profile_game_id)
   SELECT id, $profileGameId FROM game_collections WHERE id = $collectionId AND user_id = $userId
   ON CONFLICT DO NOTHING`
);

function toGameCollection(row: GameCollectionRow & { games_count?: number }) {
  return {
    id: row.id,
    name: row.name,
    gamesCount:
      row.games_count ??
      (countCollectionGamesStatement.get(row.id) as { total: number }).total,
  };
}

export function registerCollectionRoutes(app: FastifyInstance) {
  app.get("/profile/games/collections", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const rows = listCollectionsStatement.all(user.id) as unknown as (GameCollectionRow & {
      games_count: number;
    })[];
    reply.send(rows.map(toGameCollection));
  });

  app.post<{ Body: { name?: string } }>(
    "/profile/games/collections",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const name = request.body?.name?.trim();
      if (!name) return reply.code(400).send({ message: "name is required" });

      const id = crypto.randomUUID();
      insertCollectionStatement.run({
        id,
        userId: user.id,
        name,
        createdAt: new Date().toISOString(),
      });

      const row = getCollectionStatement.get(id, user.id) as unknown as GameCollectionRow;
      reply.send(toGameCollection(row));
    }
  );

  app.put<{ Params: { id: string }; Body: { name?: string } }>(
    "/profile/games/collections/:id",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const name = request.body?.name?.trim();
      if (!name) return reply.code(400).send({ message: "name is required" });

      const existing = getCollectionStatement.get(request.params.id, user.id);
      if (!existing) return reply.code(404).send({ message: "collection/not-found" });

      renameCollectionStatement.run(name, request.params.id, user.id);

      const row = getCollectionStatement.get(request.params.id, user.id) as unknown as GameCollectionRow;
      reply.send(toGameCollection(row));
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/profile/games/collections/:id",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const existing = getCollectionStatement.get(request.params.id, user.id);
      if (!existing) return reply.code(404).send({ message: "collection/not-found" });

      deleteCollectionItemsStatement.run(request.params.id);
      deleteCollectionStatement.run(request.params.id, user.id);
      reply.send({ ok: true });
    }
  );

  app.put<{
    Params: { shop: string; objectId: string };
    Body: { collectionIds?: string[] };
  }>("/profile/games/:shop/:objectId/collection", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { shop, objectId } = request.params;
    const profileGame = findProfileGameStatement.get(user.id, shop, objectId) as
      | { id: string }
      | undefined;

    if (!profileGame) {
      return reply.code(404).send({ message: "game/not-found" });
    }

    deleteItemsForGameStatement.run(profileGame.id, user.id);

    for (const collectionId of request.body?.collectionIds ?? []) {
      insertItemStatement.run({
        profileGameId: profileGame.id,
        collectionId,
        userId: user.id,
      });
    }

    reply.send({ ok: true });
  });
}
