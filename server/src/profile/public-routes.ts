import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { getUserById, type UserRow } from "../users.js";
import { getOrCacheSteamGame } from "../catalogue/steam-lookup.js";

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
  "SELECT * FROM profile_games WHERE user_id = ? ORDER BY last_time_played DESC LIMIT ?"
);
const downloadSourceIdsForGameStatement = db.prepare(
  "SELECT DISTINCT download_source_id FROM game_repacks WHERE appid = ?"
);
const achievementCountStatement = db.prepare(
  "SELECT COUNT(*) as total FROM achievement_catalogue WHERE shop = ? AND object_id = ?"
);
const unlockedAchievementCountStatement = db.prepare(
  "SELECT COUNT(*) as total FROM user_achievements WHERE profile_game_id = ?"
);

interface ProfileGameRow {
  id: string;
  shop: string;
  object_id: string;
  play_time_ms: number;
  last_time_played: string | null;
  is_favorite: number;
  is_pinned: number;
}

/** Builds the full UserGame shape the client expects (assets + achievement counts), not just the raw row. */
async function toUserGame(row: ProfileGameRow) {
  const appid = Number(row.object_id);
  const game = row.shop === "steam" ? await getOrCacheSteamGame(appid) : null;
  const downloadSourceIds =
    row.shop === "steam"
      ? (downloadSourceIdsForGameStatement.all(appid) as { download_source_id: string }[]).map(
          (r) => r.download_source_id
        )
      : [];

  const { total: achievementCount } = achievementCountStatement.get(
    row.shop,
    row.object_id
  ) as { total: number };
  const { total: unlockedAchievementCount } = unlockedAchievementCountStatement.get(row.id) as {
    total: number;
  };

  return {
    objectId: row.object_id,
    shop: row.shop,
    title: game?.title ?? row.object_id,
    iconUrl: game?.logo_url ?? null,
    libraryHeroImageUrl: game?.hero_url ?? null,
    libraryImageUrl: game?.cover_url ?? null,
    logoImageUrl: game?.logo_url ?? null,
    coverImageUrl: game?.cover_url ?? null,
    downloadSources: downloadSourceIds,
    playTimeInSeconds: Math.trunc(row.play_time_ms / 1000),
    lastTimePlayed: row.last_time_played,
    unlockedAchievementCount,
    achievementCount,
    achievementsPointsEarnedSum: 0,
    hasManuallyUpdatedPlaytime: false,
    isFavorite: Boolean(row.is_favorite),
    isPinned: Boolean(row.is_pinned),
  };
}

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
      ? await Promise.all(
          (listGamesStatement.all(owner.id, 12) as unknown as ProfileGameRow[]).map(toUserGame)
        )
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

  app.get<{
    Params: { id: string };
    Querystring: { take?: string; skip?: string; shop?: string | string[]; sortBy?: string };
  }>("/users/:id/library", async (request, reply) => {
    const owner = getUserById(request.params.id);
    if (!owner) return reply.code(404).send({ message: "User not found" });

    const viewer = tryGetViewer(request);
    const isSelf = viewer?.id === owner.id;
    const viewerIsFriend = viewer ? isFriend(viewer.id, owner.id) : false;
    const canSeeDetails =
      isSelf || owner.profile_visibility === "PUBLIC" || (owner.profile_visibility === "FRIENDS" && viewerIsFriend);

    if (!canSeeDetails) return reply.send({ library: [], pinnedGames: [] });

    const take = Number(request.query.take ?? 12);
    const skip = Number(request.query.skip ?? 0);
    const shopsParam = request.query.shop;
    const shops = shopsParam ? (Array.isArray(shopsParam) ? shopsParam : [shopsParam]) : null;
    const sortColumn = request.query.sortBy === "playTime" ? "play_time_ms" : "last_time_played";

    const shopFilter = shops && shops.length > 0 ? `AND shop IN (${shops.map(() => "?").join(",")})` : "";
    const rows = db
      .prepare(
        `SELECT * FROM profile_games WHERE user_id = ? ${shopFilter}
         ORDER BY ${sortColumn} DESC LIMIT ? OFFSET ?`
      )
      .all(owner.id, ...(shops ?? []), take, skip) as unknown as ProfileGameRow[];

    const pinnedRows = db
      .prepare(`SELECT * FROM profile_games WHERE user_id = ? AND is_pinned = 1 ${shopFilter}`)
      .all(owner.id, ...(shops ?? [])) as unknown as ProfileGameRow[];

    const [library, pinnedGames] = await Promise.all([
      Promise.all(rows.map(toUserGame)),
      Promise.all(pinnedRows.map(toUserGame)),
    ]);

    reply.send({ library, pinnedGames });
  });

  app.get<{ Params: { id: string } }>("/users/:id/stats", async (request, reply) => {
    const owner = getUserById(request.params.id);
    if (!owner) return reply.code(404).send({ message: "User not found" });

    const viewer = tryGetViewer(request);
    const isSelf = viewer?.id === owner.id;
    const viewerIsFriend = viewer ? isFriend(viewer.id, owner.id) : false;
    const canSeeDetails =
      isSelf || owner.profile_visibility === "PUBLIC" || (owner.profile_visibility === "FRIENDS" && viewerIsFriend);

    if (!canSeeDetails) {
      return reply.send({
        libraryCount: 0,
        friendsCount: 0,
        totalPlayTimeInSeconds: { value: 0, topPercentile: 0 },
      });
    }

    const { total: libraryCount } = db
      .prepare("SELECT COUNT(*) as total FROM profile_games WHERE user_id = ?")
      .get(owner.id) as { total: number };
    const { total: friendsCount } = countFriendsStatement.get(owner.id, owner.id) as {
      total: number;
    };
    const { total: unlockedAchievementSum } = db
      .prepare(
        `SELECT COUNT(*) as total FROM user_achievements ua
         JOIN profile_games pg ON pg.id = ua.profile_game_id
         WHERE pg.user_id = ?`
      )
      .get(owner.id) as { total: number };

    const playtimeRanking = db
      .prepare(
        `SELECT user_id, SUM(play_time_ms) as total_ms FROM profile_games
         GROUP BY user_id ORDER BY total_ms DESC`
      )
      .all() as { user_id: string; total_ms: number }[];
    const ownerRankIndex = playtimeRanking.findIndex((r) => r.user_id === owner.id);
    const totalPlayTimeMs = ownerRankIndex >= 0 ? playtimeRanking[ownerRankIndex].total_ms : 0;
    const topPercentile =
      ownerRankIndex >= 0 && playtimeRanking.length > 0
        ? Math.round(((ownerRankIndex + 1) / playtimeRanking.length) * 100)
        : 100;

    reply.send({
      libraryCount,
      friendsCount,
      totalPlayTimeInSeconds: { value: Math.trunc(totalPlayTimeMs / 1000), topPercentile },
      unlockedAchievementSum,
      // Steam achievements carry no point value in this design (Steam itself has none natively) —
      // always present (not omitted) so the client never renders the Hydra Cloud upsell button here.
      achievementsPointsEarnedSum: { value: 0, topPercentile: 0 },
    });
  });
}
