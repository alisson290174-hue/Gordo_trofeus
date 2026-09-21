import { db } from "../db.js";
import { config } from "../config.js";

export interface AchievementCatalogueRow {
  shop: string;
  object_id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  icon: string | null;
  icongray: string | null;
  hidden: number;
  points: number | null;
  global_unlock_percent: number | null;
  retroachievements_game_id: number | null;
  cached_at: string;
}

interface SteamSchemaAchievement {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: 0 | 1;
}

async function fetchSteamSchema(appid: number): Promise<SteamSchemaAchievement[]> {
  const url = new URL("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/");
  url.searchParams.set("key", config.steamApiKey);
  url.searchParams.set("appid", String(appid));

  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return [];

  const data = (await response.json()) as {
    game?: { availableGameStats?: { achievements?: SteamSchemaAchievement[] } };
  };
  return data.game?.availableGameStats?.achievements ?? [];
}

/**
 * The schema endpoint above never returns per-achievement point values — Steam's public API
 * doesn't expose those. Real rarity comes from this separate, keyless endpoint: the percentage
 * of players who have unlocked each achievement globally, the same signal Steam's own client
 * uses to mark an achievement "rare".
 */
async function fetchGlobalAchievementPercentages(
  appid: number
): Promise<Map<string, number>> {
  const url = new URL(
    "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/"
  );
  url.searchParams.set("gameid", String(appid));

  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return new Map();

  const data = (await response.json()) as {
    achievementpercentages?: { achievements?: { name: string; percent: number }[] };
  };

  return new Map(
    (data.achievementpercentages?.achievements ?? []).map((a) => [a.name, a.percent])
  );
}

const listCatalogueStatement = db.prepare(
  "SELECT * FROM achievement_catalogue WHERE shop = ? AND object_id = ?"
);
const upsertAchievementStatement = db.prepare(`
  INSERT INTO achievement_catalogue (shop, object_id, name, display_name, description, icon, icongray, hidden, global_unlock_percent, cached_at)
  VALUES ($shop, $objectId, $name, $displayName, $description, $icon, $icongray, $hidden, $globalUnlockPercent, $cachedAt)
  ON CONFLICT(shop, object_id, name) DO UPDATE SET
    display_name = excluded.display_name, description = excluded.description,
    icon = excluded.icon, icongray = excluded.icongray, hidden = excluded.hidden,
    global_unlock_percent = excluded.global_unlock_percent, cached_at = excluded.cached_at
`);
const updateGlobalUnlockPercentStatement = db.prepare(
  "UPDATE achievement_catalogue SET global_unlock_percent = ? WHERE shop = ? AND object_id = ? AND name = ?"
);

/** Fetches (and caches) a game's achievement catalogue from Steam's public schema API. */
export async function getOrCacheAchievementCatalogue(
  shop: string,
  objectId: string
): Promise<AchievementCatalogueRow[]> {
  const cached = listCatalogueStatement.all(shop, objectId) as unknown as AchievementCatalogueRow[];

  if (cached.length > 0) {
    // Backfills rarity for rows cached before global_unlock_percent existed, without
    // re-fetching the (much heavier) schema.
    if (shop === "steam" && cached.some((row) => row.global_unlock_percent === null)) {
      const percentages = await fetchGlobalAchievementPercentages(Number(objectId));
      for (const row of cached) {
        const percent = percentages.get(row.name);
        if (percent !== undefined) {
          updateGlobalUnlockPercentStatement.run(percent, shop, objectId, row.name);
          row.global_unlock_percent = percent;
        }
      }
    }
    return cached;
  }

  if (shop !== "steam") return [];

  const [schema, percentages] = await Promise.all([
    fetchSteamSchema(Number(objectId)),
    fetchGlobalAchievementPercentages(Number(objectId)),
  ]);
  if (schema.length === 0) return [];

  const now = new Date().toISOString();
  for (const achievement of schema) {
    upsertAchievementStatement.run({
      shop,
      objectId,
      name: achievement.name,
      displayName: achievement.displayName,
      description: achievement.description ?? null,
      icon: achievement.icon,
      icongray: achievement.icongray,
      hidden: achievement.hidden,
      globalUnlockPercent: percentages.get(achievement.name) ?? null,
      cachedAt: now,
    });
  }

  return listCatalogueStatement.all(shop, objectId) as unknown as AchievementCatalogueRow[];
}
