import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { optionalAuthUser, requireAuth } from "../auth/require-auth.js";
import { getUserById } from "../users.js";
import { getOrCacheAchievementCatalogue, type AchievementCatalogueRow } from "./steam-schema.js";
import { upsertProfileGame, type ProfileGameRow } from "../library/routes.js";
import { addKarma, KARMA } from "../karma.js";
import { config } from "../config.js";
import { getPs2Metadata } from "../catalogue/ps2-index.js";
import { canViewUserData } from "../profile/public-routes.js";
import {
  fetchRaUnlocks,
  getLinkedRaGameId,
  refreshLinkedCatalogue,
} from "../integrations/retroachievements-games.js";

interface UserAchievementRow {
  profile_game_id: string;
  achievement_name: string;
  unlock_time: number;
  hardcore_unlock_time: number | null;
  source: string;
  souvenir_id: string | null;
}

const getProfileGameByIdStatement = db.prepare(
  "SELECT * FROM profile_games WHERE id = ? AND user_id = ?"
);
const findProfileGameStatement = db.prepare(
  "SELECT * FROM profile_games WHERE user_id = ? AND shop = ? AND object_id = ?"
);
const listUserAchievementsStatement = db.prepare(
  "SELECT * FROM user_achievements WHERE profile_game_id = ?"
);
const getUserAchievementStatement = db.prepare(
  "SELECT * FROM user_achievements WHERE profile_game_id = ? AND achievement_name = ?"
);
const upsertUserAchievementStatement = db.prepare(`
  INSERT INTO user_achievements (profile_game_id, achievement_name, unlock_time, hardcore_unlock_time, source, souvenir_id)
  VALUES ($profileGameId, $name, $unlockTime, $hardcoreUnlockTime, $source, $souvenirId)
  ON CONFLICT(profile_game_id, achievement_name) DO UPDATE SET
    unlock_time = excluded.unlock_time, hardcore_unlock_time = excluded.hardcore_unlock_time,
    souvenir_id = COALESCE(excluded.souvenir_id, user_achievements.souvenir_id)
`);
const deleteUserAchievementsStatement = db.prepare(
  "DELETE FROM user_achievements WHERE profile_game_id = ?"
);
const souvenirImageUrlStatement = db.prepare("SELECT image_key FROM souvenirs WHERE id = ?");

function catalogueMap(catalogue: AchievementCatalogueRow[]) {
  return new Map(catalogue.map((a) => [a.name, a]));
}

/** Applies a batch of unlocks to a profile game, awarding karma for genuinely new unlocks/platinum. */
function applyAchievementUnlocks(
  userId: string,
  profileGame: ProfileGameRow,
  achievements: { name: string; unlockTime: number; hardcoreUnlockTime?: number | null }[],
  source: "steam" | "retroachievements"
) {
  const catalogue = catalogueMap(
    db
      .prepare("SELECT * FROM achievement_catalogue WHERE shop = ? AND object_id = ?")
      .all(profileGame.shop, profileGame.object_id) as unknown as AchievementCatalogueRow[]
  );
  const beforeCount = (
    listUserAchievementsStatement.all(profileGame.id) as unknown as UserAchievementRow[]
  ).length;

  // Clients upper-case names ("ACHIEVEMENT_1") while Steam's catalogue keeps its own casing
  // ("Achievement_1"); everything that reads unlocks matches the catalogue name exactly, so store
  // the catalogue's spelling.
  const catalogueNameByUpper = new Map([...catalogue.keys()].map((name) => [name.toUpperCase(), name]));

  for (const achievement of achievements) {
    const name = catalogueNameByUpper.get(achievement.name.toUpperCase()) ?? achievement.name;
    const existing = getUserAchievementStatement.get(profileGame.id, name) as
      | UserAchievementRow
      | undefined;

    upsertUserAchievementStatement.run({
      profileGameId: profileGame.id,
      name,
      unlockTime: achievement.unlockTime,
      hardcoreUnlockTime: achievement.hardcoreUnlockTime ?? null,
      source,
      souvenirId: null,
    });

    if (!existing) addKarma(userId, KARMA.ACHIEVEMENT_UNLOCKED);
  }

  // Platinum bonus — only once, the moment the game newly reaches 100% catalogue coverage.
  if (catalogue.size > 0) {
    const afterCount = (
      listUserAchievementsStatement.all(profileGame.id) as unknown as UserAchievementRow[]
    ).length;
    if (beforeCount < catalogue.size && afterCount >= catalogue.size) {
      addKarma(userId, KARMA.PLATINUM);
    }
  }
}

/** Clients load souvenir images straight from this URL — a bare key resolves to file:///…/key.jpeg. */
function souvenirUrl(souvenirId: string | null | undefined): string | null {
  if (!souvenirId) return null;
  const row = souvenirImageUrlStatement.get(souvenirId) as { image_key: string } | undefined;
  return row ? `${config.publicBaseUrl}/files/${row.image_key}` : null;
}

function toUnlockedAchievements(profileGameId: string) {
  const rows = listUserAchievementsStatement.all(profileGameId) as unknown as UserAchievementRow[];
  return rows.map((r) => ({
    name: r.achievement_name,
    unlockTime: r.unlock_time,
    hardcoreUnlockTime: r.hardcore_unlock_time,
    imageKey: r.souvenir_id
      ? (souvenirImageUrlStatement.get(r.souvenir_id) as { image_key: string } | undefined)
          ?.image_key
      : undefined,
  }));
}

export function registerAchievementRoutes(app: FastifyInstance) {
  app.get<{ Params: { shop: string; objectId: string }; Querystring: { language?: string } }>(
    "/games/:shop/:objectId/achievements",
    async (request, reply) => {
      const { shop, objectId } = request.params;
      const viewer = shop === "launchbox" ? optionalAuthUser(request) : null;
      if (viewer) {
        await refreshLinkedCatalogue(viewer.id, shop, objectId).catch((error) =>
          request.log.warn({ err: error }, "RetroAchievements catalogue refresh failed")
        );
      }
      const catalogue = await getOrCacheAchievementCatalogue(shop, objectId);
      reply.send(
        catalogue.map((a) => ({
          name: a.name,
          displayName: a.display_name,
          description: a.description,
          icon: a.icon,
          icongray: a.icongray,
          hidden: Boolean(a.hidden),
          points: a.points,
          globalUnlockPercent: a.global_unlock_percent,
        }))
      );
    }
  );

  // Official Hydra API shape, used by Project HAM (set HYDRA_API_URL to this server) to know
  // which achievements a game has. HAM's parser rejects nulls, so every field is a string.
  app.get<{ Querystring: { shop?: string; objectId?: string; language?: string } }>(
    "/games/achievements",
    async (request, reply) => {
      const { shop = "steam", objectId } = request.query;
      if (!objectId) return reply.code(400).send({ message: "objectId is required" });
      const catalogue = await getOrCacheAchievementCatalogue(shop, objectId);
      reply.send(
        catalogue.map((a) => ({
          name: a.name,
          displayName: a.display_name ?? a.name,
          description: a.description ?? "",
          icon: a.icon ?? "",
          icongray: a.icongray ?? a.icon ?? "",
          hidden: Boolean(a.hidden),
        }))
      );
    }
  );

  // Base game lookup used by the client's RetroAchievements mapping flow.
  app.get<{ Params: { shop: string; objectId: string } }>(
    "/games/:shop/:objectId",
    async (request, reply) => {
      // Set once a disc hash matched RetroAchievements (see /profile/retroachievements/resolve).
      const raGameId = getLinkedRaGameId(request.params.shop, request.params.objectId);
      const ps2 =
        request.params.shop === "launchbox" ? getPs2Metadata(request.params.objectId) : null;
      reply.send({
        ...(ps2
          ? {
              objectId: request.params.objectId,
              title: ps2.title,
              iconUrl: null,
              libraryHeroImageUrl: ps2.heroUrl,
              libraryImageUrl: ps2.coverUrl,
              logoImageUrl: ps2.logoUrl,
              logoPosition: null,
              coverImageUrl: ps2.coverUrl,
              releaseDate: ps2.releaseYear ? String(ps2.releaseYear) : null,
              releaseYear: ps2.releaseYear,
            }
          : {}),
        retroAchievementsGameId: raGameId,
      });
    }
  );

  app.put<{
    Body: {
      id: string;
      achievements: { name: string; unlockTime: number; hardcoreUnlockTime?: number }[];
      souvenirs?: {
        clientId: string;
        imageKey: string;
        capturedAt: number;
        achievementNames: string[];
      }[];
    };
  }>("/profile/games/achievements", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const profileGame = getProfileGameByIdStatement.get(
      request.body.id,
      user.id
    ) as unknown as ProfileGameRow | undefined;
    if (!profileGame) return reply.code(404).send({ message: "Unknown game" });

    applyAchievementUnlocks(user.id, profileGame, request.body.achievements ?? [], "steam");

    const souvenirResults: { clientId: string; id: string }[] = [];
    for (const souvenir of request.body.souvenirs ?? []) {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO souvenirs (id, user_id, profile_game_id, image_key, captured_at, primary_achievement_name, created_at)
         VALUES ($id, $userId, $profileGameId, $imageKey, $capturedAt, $primaryName, $createdAt)`
      ).run({
        id,
        userId: user.id,
        profileGameId: profileGame.id,
        imageKey: souvenir.imageKey,
        capturedAt: new Date(souvenir.capturedAt).toISOString(),
        primaryName: souvenir.achievementNames[0] ?? "",
        createdAt: new Date().toISOString(),
      });

      for (const name of souvenir.achievementNames) {
        db.prepare(
          "INSERT OR IGNORE INTO souvenir_achievements (souvenir_id, achievement_name) VALUES (?, ?)"
        ).run(id, name);
        db.prepare(
          "UPDATE user_achievements SET souvenir_id = ? WHERE profile_game_id = ? AND achievement_name = ?"
        ).run(id, profileGame.id, name);
      }

      souvenirResults.push({ clientId: souvenir.clientId, id });
    }

    reply.send({
      objectId: profileGame.object_id,
      shop: profileGame.shop,
      achievements: toUnlockedAchievements(profileGame.id),
      souvenirs: souvenirResults.length > 0 ? souvenirResults : undefined,
    });
  });

  app.delete<{ Params: { remoteId: string } }>(
    "/profile/games/achievements/:remoteId",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const profileGame = getProfileGameByIdStatement.get(request.params.remoteId, user.id) as
        | ProfileGameRow
        | undefined;
      if (!profileGame) return reply.code(404).send({ message: "Unknown game" });

      deleteUserAchievementsStatement.run(profileGame.id);
      reply.code(204).send();
    }
  );

  app.get<{
    Params: { userId: string };
    Querystring: { shop: string; objectId: string; language?: string };
  }>("/users/:userId/games/achievements", async (request, reply) => {
    // Private profiles don't expose their unlocks (was readable by anyone before).
    if (!canViewUserData(request, request.params.userId)) {
      return reply.code(403).send({ message: "This profile is private" });
    }
    const { shop, objectId } = request.query;
    const profileGame = findProfileGameStatement.get(request.params.userId, shop, objectId) as
      | ProfileGameRow
      | undefined;

    const catalogue = await getOrCacheAchievementCatalogue(shop, objectId);
    const unlocked = profileGame
      ? new Map(
          (
            listUserAchievementsStatement.all(profileGame.id) as unknown as UserAchievementRow[]
          ).map((r) => [r.achievement_name, r])
        )
      : new Map<string, UserAchievementRow>();

    reply.send(
      catalogue.map((a) => {
        const unlock = unlocked.get(a.name);
        return {
          name: a.name,
          displayName: a.display_name,
          description: a.description,
          icon: a.icon,
          icongray: a.icongray,
          hidden: Boolean(a.hidden),
          points: a.points,
          globalUnlockPercent: a.global_unlock_percent,
          unlocked: Boolean(unlock),
          unlockTime: unlock?.unlock_time ?? null,
          hardcoreUnlockTime: unlock?.hardcore_unlock_time ?? null,
          source: unlock?.source,
          imageUrl: souvenirUrl(unlock?.souvenir_id),
        };
      })
    );
  });

  app.get<{
    Params: { userId: string };
    Querystring: { shop: string; objectId: string; language?: string };
  }>("/users/:userId/games/achievements/compare", async (request, reply) => {
    const owner = requireAuth(request, reply);
    if (!owner) return;

    const targetUser = getUserById(request.params.userId);
    if (!targetUser) return reply.code(404).send({ message: "User not found" });

    const { shop, objectId } = request.query;
    const catalogue = await getOrCacheAchievementCatalogue(shop, objectId);

    const ownerGame = findProfileGameStatement.get(owner.id, shop, objectId) as
      | ProfileGameRow
      | undefined;
    const targetGame = findProfileGameStatement.get(request.params.userId, shop, objectId) as
      | ProfileGameRow
      | undefined;

    const ownerUnlocks = new Map(
      ownerGame
        ? (listUserAchievementsStatement.all(ownerGame.id) as unknown as UserAchievementRow[]).map(
            (r) => [r.achievement_name, r]
          )
        : []
    );
    const targetUnlocks = new Map(
      targetGame
        ? (listUserAchievementsStatement.all(targetGame.id) as unknown as UserAchievementRow[]).map(
            (r) => [r.achievement_name, r]
          )
        : []
    );

    reply.send({
      achievementsPointsTotal: 0,
      owner: {
        totalAchievementCount: catalogue.length,
        unlockedAchievementCount: ownerUnlocks.size,
      },
      target: {
        displayName: targetUser.display_name,
        profileImageUrl: targetUser.profile_image_url,
        totalAchievementCount: catalogue.length,
        unlockedAchievementCount: targetUnlocks.size,
        achievementsPointsEarnedSum: 0,
      },
      achievements: catalogue.map((a) => ({
        hidden: Boolean(a.hidden),
        icon: a.icon,
        displayName: a.display_name,
        description: a.description,
        ownerStat: ownerUnlocks.has(a.name)
          ? { unlocked: true, unlockTime: ownerUnlocks.get(a.name)!.unlock_time }
          : { unlocked: false, unlockTime: null },
        targetStat: targetUnlocks.has(a.name)
          ? { unlocked: true, unlockTime: targetUnlocks.get(a.name)!.unlock_time }
          : { unlocked: false, unlockTime: null },
      })),
    });
  });

  app.post<{
    Params: { shop: string; objectId: string };
  }>("/profile/games/:shop/:objectId/retroachievements/sync", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { shop, objectId } = request.params;
    // Unlocks come from RetroAchievements itself (user's own key), not from the client.
    let unlocks: Awaited<ReturnType<typeof fetchRaUnlocks>>;
    try {
      unlocks = await fetchRaUnlocks(user.id, shop, objectId);
    } catch (error) {
      request.log.warn({ err: error }, "RetroAchievements sync failed");
      return reply.code(502).send({ message: "RetroAchievements unavailable" });
    }
    const profileGame = upsertProfileGame(user.id, shop, objectId, 0, null);
    applyAchievementUnlocks(user.id, profileGame, unlocks, "retroachievements");

    reply.send({
      objectId,
      shop,
      achievements: toUnlockedAchievements(profileGame.id),
    });
  });
}
