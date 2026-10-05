import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { getUserById, type UserRow } from "../users.js";
import { getOrCacheSteamGame } from "../catalogue/steam-lookup.js";
import { getPs2Metadata } from "../catalogue/ps2-index.js";
import { getCachedSwitchMetadata } from "../catalogue/switch-titles.js";

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
const downloadSourceNamesForGameStatement = db.prepare(
  `SELECT DISTINCT ds.name as name FROM game_repacks gr
   JOIN download_sources ds ON ds.id = gr.download_source_id
   WHERE gr.appid = ?`
);
// Offline trophies only, like the library and the platinum (see library/routes.ts).
const achievementCountStatement = db.prepare(
  "SELECT COUNT(*) as total FROM achievement_catalogue WHERE shop = ? AND object_id = ? AND COALESCE(is_online, 0) = 0"
);
const unlockedAchievementCountStatement = db.prepare(
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
  // Classics: real title and art from the PS2 index instead of "rom-sku-SCES50959".
  const ps2 =
    row.shop === "launchbox"
      ? (getPs2Metadata(row.object_id) ?? getCachedSwitchMetadata(row.object_id))
      : null;
  const downloadSourceIds =
    row.shop === "steam"
      ? (downloadSourceNamesForGameStatement.all(appid) as { name: string | null }[])
          .map((r) => r.name)
          .filter((name): name is string => Boolean(name))
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
    title: game?.title ?? ps2?.title ?? row.object_id,
    iconUrl: game?.logo_url ?? null,
    libraryHeroImageUrl: game?.hero_url ?? ps2?.heroUrl ?? null,
    libraryImageUrl: game?.cover_url ?? ps2?.coverUrl ?? null,
    logoImageUrl: game?.logo_url ?? ps2?.logoUrl ?? null,
    coverImageUrl: game?.cover_url ?? ps2?.coverUrl ?? null,
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

/**
 * Profile privacy rule shared by every route that exposes a user's data (profile, library,
 * achievements, friends): self, PUBLIC profiles, or FRIENDS profiles seen by an accepted friend.
 */
export function canViewUserData(
  request: { headers: { authorization?: string } },
  ownerId: string
): boolean {
  const owner = getUserById(ownerId);
  if (!owner) return false;
  const viewer = tryGetViewer(request);
  if (viewer?.id === owner.id) return true;
  if (owner.profile_visibility === "PUBLIC") return true;
  return (
    owner.profile_visibility === "FRIENDS" && Boolean(viewer) && isFriend(viewer!.id, owner.id)
  );
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

  app.get<{ Params: { id: string } }>("/users/:id/games/platinum", async (request, reply) => {
    const owner = getUserById(request.params.id);
    if (!owner) return reply.code(404).send({ message: "User not found" });

    const viewer = tryGetViewer(request);
    const isSelf = viewer?.id === owner.id;
    const viewerIsFriend = viewer ? isFriend(viewer.id, owner.id) : false;
    const canSeeDetails =
      isSelf || owner.profile_visibility === "PUBLIC" || (owner.profile_visibility === "FRIENDS" && viewerIsFriend);

    if (!canSeeDetails) return reply.send({ games: [], total: 0 });

    const rows = db
      .prepare("SELECT * FROM profile_games WHERE user_id = ?")
      .all(owner.id) as unknown as ProfileGameRow[];

    const withCounts = rows.map((row) => {
      const { total } = achievementCountStatement.get(row.shop, row.object_id) as { total: number };
      const { total: unlocked } = unlockedAchievementCountStatement.get(row.id) as { total: number };
      return { row, total, unlocked };
    });

    const platinumRows = withCounts
      .filter(({ total, unlocked }) => total > 0 && unlocked === total)
      .map(({ row }) => row);

    const games = await Promise.all(platinumRows.map(toUserGame));

    reply.send({ games, total: games.length });
  });

  // Trophy summary for the profile (Conceito 1 "Perfil de troféus"): per-tier counts across
  // the whole library plus per-game tier breakdowns and dates, so the client can draw the
  // level/tier band, the platinum showcase, the activity feed and the side-by-side compare
  // without one request per game. Tiers follow the client's rule (shared/achievement-tier.ts):
  // gold < 10% global unlock, silver < 40%, bronze otherwise (unknown rarity = bronze).
  // Online-only achievements are left out, like everywhere else platinum is computed.
  app.get<{ Params: { id: string } }>("/users/:id/trophy-summary", async (request, reply) => {
    const owner = getUserById(request.params.id);
    if (!owner) return reply.code(404).send({ message: "User not found" });

    const viewer = tryGetViewer(request);
    const isSelf = viewer?.id === owner.id;
    const viewerIsFriend = viewer ? isFriend(viewer.id, owner.id) : false;
    const canSeeDetails =
      isSelf || owner.profile_visibility === "PUBLIC" || (owner.profile_visibility === "FRIENDS" && viewerIsFriend);

    const emptyCounts = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
    if (!canSeeDetails) return reply.send({ counts: emptyCounts, games: [] });

    type Tier = "gold" | "silver" | "bronze";
    const tierOf = (pct: number | null): Tier =>
      pct == null ? "bronze" : pct < 10 ? "gold" : pct < 40 ? "silver" : "bronze";

    const rows = db
      .prepare("SELECT * FROM profile_games WHERE user_id = ?")
      .all(owner.id) as unknown as ProfileGameRow[];

    const catalogueStatement = db.prepare(
      `SELECT name, global_unlock_percent AS pct FROM achievement_catalogue
       WHERE shop = ? AND object_id = ? AND COALESCE(is_online, 0) = 0`
    );
    const unlocksStatement = db.prepare(
      "SELECT achievement_name AS name, unlock_time AS time FROM user_achievements WHERE profile_game_id = ?"
    );

    const counts = { ...emptyCounts };
    const games = [];

    for (const row of rows) {
      const catalogue = catalogueStatement.all(row.shop, row.object_id) as {
        name: string;
        pct: number | null;
      }[];
      if (catalogue.length === 0) continue;

      const unlockTimes = new Map(
        (unlocksStatement.all(row.id) as { name: string; time: number }[]).map((u) => [u.name, u.time])
      );

      const tiers = {
        gold: { earned: 0, total: 0 },
        silver: { earned: 0, total: 0 },
        bronze: { earned: 0, total: 0 },
      };
      let unlocked = 0;
      let lastUnlockAt = 0;

      for (const achievement of catalogue) {
        const tier = tierOf(achievement.pct);
        tiers[tier].total += 1;
        const time = unlockTimes.get(achievement.name);
        if (time != null) {
          tiers[tier].earned += 1;
          unlocked += 1;
          if (time > lastUnlockAt) lastUnlockAt = time;
        }
      }

      const isPlatinum = unlocked === catalogue.length;
      counts.gold += tiers.gold.earned;
      counts.silver += tiers.silver.earned;
      counts.bronze += tiers.bronze.earned;
      if (isPlatinum) counts.platinum += 1;

      const base = await toUserGame(row);
      games.push({
        ...base,
        achievementCount: catalogue.length,
        unlockedAchievementCount: unlocked,
        tiers,
        isPlatinum,
        lastUnlockAt: lastUnlockAt || null,
        platinumAt: isPlatinum ? lastUnlockAt || null : null,
      });
    }

    counts.total = counts.platinum + counts.gold + counts.silver + counts.bronze;
    games.sort((a, b) => (b.lastUnlockAt ?? 0) - (a.lastUnlockAt ?? 0));

    reply.send({ counts, games });
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
        platinumCount: 0,
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

    // Same "platinum" definition as /users/:id/games/platinum: every catalogued
    // achievement for the game is unlocked, and the game actually has achievements.
    const ownedGameRows = db
      .prepare("SELECT id, shop, object_id FROM profile_games WHERE user_id = ?")
      .all(owner.id) as { id: string; shop: string; object_id: string }[];
    const platinumCount = ownedGameRows.filter((row) => {
      const { total } = achievementCountStatement.get(row.shop, row.object_id) as {
        total: number;
      };
      if (total === 0) return false;
      const { total: unlocked } = unlockedAchievementCountStatement.get(row.id) as {
        total: number;
      };
      return unlocked === total;
    }).length;

    reply.send({
      libraryCount,
      friendsCount,
      totalPlayTimeInSeconds: { value: Math.trunc(totalPlayTimeMs / 1000), topPercentile },
      unlockedAchievementSum,
      platinumCount,
      // Steam achievements carry no point value in this design (Steam itself has none natively) —
      // always present (not omitted) so the client never renders the Hydra Cloud upsell button here.
      achievementsPointsEarnedSum: { value: 0, topPercentile: 0 },
    });
  });
}
