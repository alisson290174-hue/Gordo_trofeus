import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";
import { getUserById, type UserRow } from "../users.js";
import { addKarma, KARMA } from "../karma.js";
import { config } from "../config.js";

const MAX_SOUVENIR_BYTES = 8 * 1024 * 1024;

interface SouvenirRow {
  id: string;
  user_id: string;
  profile_game_id: string;
  image_key: string;
  captured_at: string;
  primary_achievement_name: string;
  visibility: "PUBLIC" | "PRIVATE" | "FRIENDS";
  like_count: number;
  created_at: string;
}

const insertTokenStatement = db.prepare(
  `INSERT INTO upload_tokens (token, user_id, type, max_bytes, created_at) VALUES (?, ?, 'achievement-image', ?, ?)`
);

const getSouvenirStatement = db.prepare("SELECT * FROM souvenirs WHERE id = ?");
const listSouvenirsForUserStatement = db.prepare(
  "SELECT * FROM souvenirs WHERE user_id = ? ORDER BY captured_at DESC LIMIT ? OFFSET ?"
);
const achievementsForSouvenirStatement = db.prepare(
  "SELECT achievement_name FROM souvenir_achievements WHERE souvenir_id = ?"
);
const hasLikedStatement = db.prepare(
  "SELECT 1 FROM souvenir_likes WHERE souvenir_id = ? AND user_id = ?"
);
const likeStatement = db.prepare(
  "INSERT INTO souvenir_likes (souvenir_id, user_id) VALUES (?, ?)"
);
const unlikeStatement = db.prepare(
  "DELETE FROM souvenir_likes WHERE souvenir_id = ? AND user_id = ?"
);
const bumpLikeCountStatement = db.prepare(
  "UPDATE souvenirs SET like_count = like_count + ? WHERE id = ?"
);
const setVisibilityStatement = db.prepare("UPDATE souvenirs SET visibility = ? WHERE id = ?");
const deleteSouvenirStatement = db.prepare("DELETE FROM souvenirs WHERE id = ?");

function toProfileSouvenir(row: SouvenirRow) {
  const achievementNames = (
    achievementsForSouvenirStatement.all(row.id) as { achievement_name: string }[]
  ).map((a) => a.achievement_name);

  return {
    id: row.id,
    imageUrl: `${config.publicBaseUrl}/files/${row.image_key}`,
    capturedAt: row.captured_at,
    primaryAchievementName: row.primary_achievement_name,
    achievements: achievementNames.map((name) => ({ name })),
    visibility: row.visibility,
    likeCount: row.like_count,
  };
}

/** Mirrors the visibility rule already applied to profile data: PRIVATE/FRIENDS are only visible
 * to the owner or (for FRIENDS) an accepted relation — the client trusts the server completely here. */
function canView(owner: UserRow, viewerId: string | null): "PUBLIC" | "FRIENDS_ONLY" | "PRIVATE" | null {
  if (viewerId === owner.id) return null; // no restriction, it's your own
  if (owner.souvenirs_visibility === "PUBLIC") return null;
  if (owner.souvenirs_visibility === "PRIVATE") return "PRIVATE";

  const isFriend = viewerId
    ? db
        .prepare(
          `SELECT 1 FROM relations WHERE status = 'ACCEPTED' AND
           ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?))`
        )
        .get(viewerId, owner.id, owner.id, viewerId)
    : null;
  return isFriend ? null : "FRIENDS_ONLY";
}

export function registerSouvenirRoutes(app: FastifyInstance) {
  app.post<{ Body: { imageExt?: string; imageLength?: number } }>(
    "/presigned-urls/achievement-image",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      if ((request.body?.imageLength ?? 0) > MAX_SOUVENIR_BYTES) {
        return reply.code(413).send({ message: "Image too large" });
      }

      const token = crypto.randomBytes(24).toString("base64url");
      const extension = (request.body?.imageExt ?? "jpg").replace(/[^a-zA-Z0-9]/g, "") || "jpg";
      const imageKey = `${token}.${extension}`;

      insertTokenStatement.run(token, user.id, MAX_SOUVENIR_BYTES, new Date().toISOString());

      reply.send({
        imageKey,
        presignedUrl: `${config.publicBaseUrl}/uploads/${token}`,
        status: "pending",
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
    }
  );

  app.get<{
    Params: { userId: string };
    Querystring: { take?: string; skip?: string; sortBy?: string };
  }>("/users/:userId/souvenirs", async (request, reply) => {
    const viewer = request.headers.authorization ? requireAuth(request, reply) : null;
    if (request.headers.authorization && !viewer) return;

    const owner = getUserById(request.params.userId);
    if (!owner) return reply.code(404).send({ message: "User not found" });

    const hiddenReason = canView(owner, viewer?.id ?? null);
    if (hiddenReason) {
      return reply.send({ items: [], total: 0, hasReachedLimit: false, hiddenReason });
    }

    const take = Number(request.query.take ?? 24);
    const skip = Number(request.query.skip ?? 0);
    const rows = listSouvenirsForUserStatement.all(
      owner.id,
      take,
      skip
    ) as unknown as SouvenirRow[];

    reply.send({
      items: rows.map(toProfileSouvenir),
      total: rows.length,
      hasReachedLimit: false,
      hiddenReason: null,
    });
  });

  app.post<{ Params: { ownerId: string; id: string } }>(
    "/users/:ownerId/souvenirs/:id/like",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const souvenir = getSouvenirStatement.get(request.params.id) as SouvenirRow | undefined;
      if (!souvenir) return reply.code(404).send({ message: "Souvenir not found" });

      const alreadyLiked = hasLikedStatement.get(souvenir.id, user.id);
      if (alreadyLiked) {
        unlikeStatement.run(souvenir.id, user.id);
        bumpLikeCountStatement.run(-1, souvenir.id);
      } else {
        likeStatement.run(souvenir.id, user.id);
        bumpLikeCountStatement.run(1, souvenir.id);
        addKarma(souvenir.user_id, KARMA.SOUVENIR_LIKED);
      }

      reply.send(toProfileSouvenir(getSouvenirStatement.get(souvenir.id) as unknown as SouvenirRow));
    }
  );

  app.post<{
    Params: { ownerId: string; id: string };
    Body: { reason: string; description?: string };
  }>("/users/:ownerId/souvenirs/:id/report", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const souvenir = getSouvenirStatement.get(request.params.id) as SouvenirRow | undefined;
    if (!souvenir) return reply.code(404).send({ message: "Souvenir not found" });

    db.prepare(
      `INSERT INTO souvenir_reports (id, souvenir_id, reporter_id, reason, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      souvenir.id,
      user.id,
      request.body.reason,
      request.body.description ?? null,
      new Date().toISOString()
    );

    reply.code(201).send({ message: "Reported" });
  });

  app.patch<{ Params: { id: string }; Body: { visibility: "PUBLIC" | "PRIVATE" } }>(
    "/profile/souvenirs/:id/visibility",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const souvenir = getSouvenirStatement.get(request.params.id) as SouvenirRow | undefined;
      if (!souvenir || souvenir.user_id !== user.id) {
        return reply.code(404).send({ message: "Souvenir not found" });
      }

      setVisibilityStatement.run(request.body.visibility, souvenir.id);
      reply.send(toProfileSouvenir(getSouvenirStatement.get(souvenir.id) as unknown as SouvenirRow));
    }
  );

  app.delete<{ Params: { id: string } }>("/profile/souvenirs/:id", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const souvenir = getSouvenirStatement.get(request.params.id) as SouvenirRow | undefined;
    if (!souvenir || souvenir.user_id !== user.id) {
      return reply.code(404).send({ message: "Souvenir not found" });
    }

    deleteSouvenirStatement.run(souvenir.id);
    reply.code(204).send();
  });
}
