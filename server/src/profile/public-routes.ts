import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { getUserById, type UserRow } from "../users.js";

interface RelationRow {
  a_id: string;
  b_id: string;
  status: "PENDING" | "ACCEPTED";
}

const getRelationStatement = db.prepare(
  `SELECT * FROM relations WHERE (a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)`
);
const countFriendsStatement = db.prepare(
  "SELECT COUNT(*) as total FROM relations WHERE status = 'ACCEPTED' AND (a_id = ? OR b_id = ?)"
);
const listFriendsPreviewStatement = db.prepare(
  "SELECT a_id, b_id FROM relations WHERE status = 'ACCEPTED' AND (a_id = ? OR b_id = ?) LIMIT 6"
);
const listGamesStatement = db.prepare(
  "SELECT shop, object_id, play_time_ms, last_time_played FROM profile_games WHERE user_id = ? ORDER BY last_time_played DESC LIMIT ?"
);

/** Best-effort viewer identity — this endpoint works both logged out and logged in. */
function tryGetViewer(request: { headers: { authorization?: string } }): UserRow | null {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) return null;

  try {
    const payload = verifyAccessToken(token);
    return getUserById(payload.sub) ?? null;
  } catch {
    return null;
  }
}

function isFriend(viewerId: string, ownerId: string): boolean {
  const relation = getRelationStatement.get(viewerId, ownerId, ownerId, viewerId) as
    | RelationRow
    | undefined;
  return relation?.status === "ACCEPTED";
}

export function registerPublicProfileRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const owner = getUserById(request.params.id);
    if (!owner) return reply.code(404).send({ message: "User not found" });

    const viewer = tryGetViewer(request);
    const isSelf = viewer?.id === owner.id;
    const viewerIsFriend = viewer ? isFriend(viewer.id, owner.id) : false;

    // Visibility enforced here, server-side — the client trusts whatever this endpoint returns.
    const canSeeDetails =
      isSelf || owner.profile_visibility === "PUBLIC" || (owner.profile_visibility === "FRIENDS" && viewerIsFriend);

    const relation = viewer
      ? ((getRelationStatement.get(viewer.id, owner.id, owner.id, viewer.id) as
          | RelationRow
          | undefined) ?? null)
      : null;

    const { total: totalFriends } = countFriendsStatement.get(owner.id, owner.id) as {
      total: number;
    };

    const friendsPreview = canSeeDetails
      ? (listFriendsPreviewStatement.all(owner.id, owner.id) as unknown as RelationRow[])
          .map((r) => getUserById(r.a_id === owner.id ? r.b_id : r.a_id))
          .filter((u): u is UserRow => u !== undefined)
          .map((u) => ({
            id: u.id,
            displayName: u.display_name,
            profileImageUrl: u.profile_image_url,
            currentGame: null,
            isOnline: false,
          }))
      : [];

    const games = canSeeDetails
      ? (
          listGamesStatement.all(owner.id, 12) as {
            shop: string;
            object_id: string;
            play_time_ms: number;
            last_time_played: string | null;
          }[]
        ).map((g) => ({
          shop: g.shop,
          objectId: g.object_id,
          playTimeInMilliseconds: g.play_time_ms,
          lastTimePlayed: g.last_time_played,
        }))
      : [];

    reply.send({
      id: owner.id,
      displayName: owner.display_name,
      profileImageUrl: owner.profile_image_url,
      email: null,
      backgroundImageUrl: owner.background_image_url,
      profileVisibility: owner.profile_visibility,
      souvenirsVisibility: owner.souvenirs_visibility,
      libraryGames: games,
      recentGames: games.slice(0, 6),
      friends: friendsPreview,
      totalFriends,
      relation: relation ? { AId: relation.a_id, BId: relation.b_id, status: relation.status } : null,
      currentGame: null,
      bio: canSeeDetails ? owner.bio : "",
      hasActiveSubscription: true,
      canReceiveCloudGift: false,
      allowCloudGifts: Boolean(owner.allow_cloud_gifts),
      karma: owner.karma,
      quirks: { backupsPerGameLimit: owner.backups_per_game_limit },
      badges: [],
      hasCompletedWrapped2025: false,
    });
  });

  app.get<{ Params: { id: string } }>("/users/:id/stats", async (request, reply) => {
    const owner = getUserById(request.params.id);
    if (!owner) return reply.code(404).send({ message: "User not found" });
    reply.send({ karma: owner.karma });
  });
}
