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

const listCatalogueStatement = db.prepare(
  "SELECT * FROM achievement_catalogue WHERE shop = ? AND object_id = ?"
);
const upsertAchievementStatement = db.prepare(`
  INSERT INTO achievement_catalogue (shop, object_id, name, display_name, description, icon, icongray, hidden, cached_at)
  VALUES ($shop, $objectId, $name, $displayName, $description, $icon, $icongray, $hidden, $cachedAt)
  ON CONFLICT(shop, object_id, name) DO UPDATE SET
    display_name = excluded.display_name, description = excluded.description,
    icon = excluded.icon, icongray = excluded.icongray, hidden = excluded.hidden, cached_at = excluded.cached_at
`);

/** Fetches (and caches) a game's achievement catalogue from Steam's public schema API. */
export async function getOrCacheAchievementCatalogue(
  shop: string,
  objectId: string
): Promise<AchievementCatalogueRow[]> {
  const cached = listCatalogueStatement.all(shop, objectId) as unknown as AchievementCatalogueRow[];
  if (cached.length > 0) return cached;

  if (shop !== "steam") return [];

  const schema = await fetchSteamSchema(Number(objectId));
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
      cachedAt: now,
    });
  }

  return listCatalogueStatement.all(shop, objectId) as unknown as AchievementCatalogueRow[];
}
