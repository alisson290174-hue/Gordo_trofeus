import type { FastifyInstance } from "fastify";
import { canViewUserData } from "../profile/public-routes.js";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";
import { getUserById, getUserBySteamId, type UserRow } from "../users.js";

interface RelationRow {
  a_id: string;
  b_id: string;
  status: "PENDING" | "ACCEPTED";
  created_at: string;
}

const getRelationBetweenStatement = db.prepare(
  `SELECT * FROM relations WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)`
);
const insertRelationStatement = db.prepare(
  "INSERT INTO relations (a_id, b_id, status, created_at) VALUES (?, ?, 'PENDING', ?)"
);
const acceptRelationStatement = db.prepare(
  "UPDATE relations SET status = 'ACCEPTED' WHERE a_id = ? AND b_id = ?"
);
const deleteRelationStatement = db.prepare(
  "DELETE FROM relations WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)"
);
const pendingForUserStatement = db.prepare(
  "SELECT * FROM relations WHERE status = 'PENDING' AND (a_id = ? OR b_id = ?)"
);
const acceptedForUserStatement = db.prepare(
  "SELECT * FROM relations WHERE status = 'ACCEPTED' AND (a_id = ? OR b_id = ?) LIMIT ? OFFSET ?"
);
const countAcceptedStatement = db.prepare(
  "SELECT COUNT(*) as total FROM relations WHERE status = 'ACCEPTED' AND (a_id = ? OR b_id = ?)"
);

const insertBlockStatement = db.prepare(
  "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
);
const deleteBlockStatement = db.prepare(
  "DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?"
);
const listBlocksStatement = db.prepare(
  "SELECT blocked_id FROM blocks WHERE blocker_id = ? LIMIT ? OFFSET ?"
);
const countBlocksStatement = db.prepare(
  "SELECT COUNT(*) as total FROM blocks WHERE blocker_id = ?"
);

function otherUserId(relation: RelationRow, selfId: string): string {
  return relation.a_id === selfId ? relation.b_id : relation.a_id;
}

function toUserFriend(user: UserRow) {
  return {
    id: user.id,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    backgroundImageUrl: user.background_image_url,
    currentGame: null,
    isOnline: false, // no realtime layer — matches the plan's decision to skip WebSocket presence
  };
}

export function registerFriendRoutes(app: FastifyInstance) {
  app.get("/profile/friend-requests", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const rows = pendingForUserStatement.all(user.id, user.id) as unknown as RelationRow[];
    const requests = rows
      .map((r) => {
        const other = getUserById(otherUserId(r, user.id));
        if (!other) return null;
        return {
          id: other.id,
          displayName: other.display_name,
          profileImageUrl: other.profile_image_url,
          type: r.a_id === user.id ? "SENT" : "RECEIVED",
        };
      })
      .filter(Boolean);

    reply.send(requests);
  });

  app.post<{ Body: { data?: { friendCode?: string } } }>(
    "/profile/friend-requests",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      // The friend code is the account id, but a 17-digit Steam ID is accepted too — it's what
      // people usually have at hand. Either way the friend must have signed in once already.
      const rawCode = request.body?.data?.friendCode?.trim();
      const target = rawCode
        ? /^\d{17}$/.test(rawCode)
          ? getUserBySteamId(rawCode)
          : getUserById(rawCode)
        : undefined;
      if (!rawCode || target?.id === user.id) {
        return reply.code(400).send({ message: "Invalid friend code" });
      }
      if (!target) return reply.code(404).send({ message: "User not found" });
      const friendCode = target.id;

      const existing = getRelationBetweenStatement.get(
        user.id,
        friendCode,
        friendCode,
        user.id
      );
      if (existing) return reply.code(409).send({ message: "Relation already exists" });

      insertRelationStatement.run(user.id, friendCode, new Date().toISOString());
      reply.code(201).send({ message: "Friend request sent" });
    }
  );

  app.patch<{ Params: { userId: string }; Body: { data?: { requestState?: string } } }>(
    "/profile/friend-requests/:userId",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const senderId = request.params.userId;
      const requestState = request.body?.data?.requestState;

      if (requestState === "ACCEPTED") {
        acceptRelationStatement.run(senderId, user.id);
      } else {
        deleteRelationStatement.run(senderId, user.id, user.id, senderId);
      }
      reply.code(204).send();
    }
  );

  app.delete<{ Params: { userId: string } }>(
    "/profile/friend-requests/:userId",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      deleteRelationStatement.run(
        user.id,
        request.params.userId,
        request.params.userId,
        user.id
      );
      reply.code(204).send();
    }
  );

  app.get<{ Querystring: { take?: string; skip?: string } }>(
    "/profile/friends",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const take = Number(request.query.take ?? 50);
      const skip = Number(request.query.skip ?? 0);
      const rows = acceptedForUserStatement.all(
        user.id,
        user.id,
        take,
        skip
      ) as unknown as RelationRow[];
      const { total } = countAcceptedStatement.get(user.id, user.id) as { total: number };

      const friends = rows
        .map((r) => getUserById(otherUserId(r, user.id)))
        .filter((u): u is UserRow => Boolean(u))
        .map(toUserFriend);

      reply.send({ totalFriends: total, onlineFriends: 0, friends });
    }
  );

  app.get<{ Params: { id: string }; Querystring: { take?: string; skip?: string } }>(
    "/users/:id/friends",
    async (request, reply) => {
      const targetId = request.params.id;
      // A user's friend list follows the same privacy rule as the rest of the profile.
      if (!canViewUserData(request, targetId)) {
        return reply.code(403).send({ message: "This profile is private" });
      }
      const take = Math.min(Math.max(Number(request.query.take ?? 50) || 50, 1), 100);
      const skip = Math.max(Number(request.query.skip ?? 0) || 0, 0);

      const rows = acceptedForUserStatement.all(
        targetId,
        targetId,
        take,
        skip
      ) as unknown as RelationRow[];
      const { total } = countAcceptedStatement.get(targetId, targetId) as { total: number };

      const friends = rows
        .map((r) => getUserById(otherUserId(r, targetId)))
        .filter((u): u is UserRow => Boolean(u))
        .map(toUserFriend);

      reply.send({ totalFriends: total, friends });
    }
  );

  app.get<{ Querystring: { query?: string; take?: string; skip?: string } }>(
    "/profile/friends/search",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const term = (request.query.query ?? "").toLowerCase();
      const rows = acceptedForUserStatement.all(
        user.id,
        user.id,
        1000,
        0
      ) as unknown as RelationRow[];

      const friends = rows
        .map((r) => getUserById(otherUserId(r, user.id)))
        .filter((u): u is UserRow => u !== undefined && u.display_name.toLowerCase().includes(term))
        .map(toUserFriend);

      reply.send({ friends });
    }
  );

  app.post<{ Params: { id: string } }>("/users/:id/block", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    insertBlockStatement.run(user.id, request.params.id, new Date().toISOString());
    deleteRelationStatement.run(user.id, request.params.id, request.params.id, user.id);
    reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/users/:id/unblock", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    deleteBlockStatement.run(user.id, request.params.id);
    reply.code(204).send();
  });

  app.get<{ Querystring: { take?: string; skip?: string } }>(
    "/profile/blocks",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const take = Number(request.query.take ?? 50);
      const skip = Number(request.query.skip ?? 0);
      const rows = listBlocksStatement.all(user.id, take, skip) as { blocked_id: string }[];
      const { total } = countBlocksStatement.get(user.id) as { total: number };

      const blocks = rows
        .map((r) => getUserById(r.blocked_id))
        .filter((u): u is UserRow => Boolean(u))
        .map(toUserFriend);

      reply.send({ totalBlocks: total, blocks });
    }
  );
}
