import { db } from "../db.js";

/**
 * Links library games (PS2 discs, shop "launchbox") to RetroAchievements games and keeps their
 * trophy catalogue on this server, so the game page, profile and comparison all work like Steam.
 *
 * - The client hashes the disc exactly like PCSX2/rcheevos and sends only the hash.
 * - The hash is matched against RetroAchievements' official hash list (fetched with the caller's
 *   own Web API key, already stored when they connected the account), so a link always points to
 *   a real RA game for that exact disc.
 * - Achievements and unlocks are fetched here from the official API, never accepted from clients.
 */
const RA_API = "https://retroachievements.org/API";
const RA_MEDIA = "https://media.retroachievements.org/Badge";
export const PS2_CONSOLE_ID = 21;
const HASH_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOGUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

interface RaApiAchievement {
  ID: number;
  Title?: string;
  Description?: string;
  Points?: number;
  BadgeName?: string;
  DisplayOrder?: number;
  NumAwarded?: number;
  DateEarned?: string | null;
  DateEarnedHardcore?: string | null;
}

async function raGet<T>(endpoint: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${RA_API}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { "user-agent": "BaloiServer/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RetroAchievements ${endpoint}: HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error(`RetroAchievements ${endpoint}: too large`);
  return JSON.parse(text) as T;
}

const integrationKeyStatement = db.prepare(
  "SELECT username, web_api_key FROM retroachievements_integrations WHERE user_id = ?"
);
export function getRaCredentials(userId: string) {
  return integrationKeyStatement.get(userId) as
    | { username: string; web_api_key: string }
    | undefined;
}

// --- hash list -------------------------------------------------------------------------------

const hashListFetchedStatement = db.prepare(
  "SELECT fetched_at FROM ra_hash_lists WHERE console_id = ?"
);
const deleteHashesStatement = db.prepare("DELETE FROM ra_game_hashes WHERE console_id = ?");
const insertHashStatement = db.prepare(
  "INSERT OR REPLACE INTO ra_game_hashes (hash, ra_game_id, title, console_id) VALUES (?, ?, ?, ?)"
);
const markHashListStatement = db.prepare(
  "INSERT OR REPLACE INTO ra_hash_lists (console_id, fetched_at) VALUES (?, ?)"
);
const findHashStatement = db.prepare(
  "SELECT ra_game_id, title FROM ra_game_hashes WHERE hash = ? AND console_id = ?"
);

// One download per console at a time (PS1, PS2, SNES… refresh independently).
const hashListRefreshes = new Map<number, Promise<void>>();

async function refreshHashList(consoleId: number, webApiKey: string) {
  const games = await raGet<{ ID: number; Title?: string; Hashes?: string[] }[]>(
    "API_GetGameList.php",
    { i: consoleId, h: 1, f: 1, y: webApiKey }
  );
  if (!Array.isArray(games) || games.length === 0) throw new Error("Empty RetroAchievements game list");

  db.exec("BEGIN");
  try {
    deleteHashesStatement.run(consoleId);
    for (const game of games) {
      for (const hash of game.Hashes ?? []) {
        if (/^[0-9a-f]{32}$/i.test(hash)) {
          insertHashStatement.run(hash.toLowerCase(), game.ID, game.Title ?? null, consoleId);
        }
      }
    }
    markHashListStatement.run(consoleId, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function ensureHashList(consoleId: number, webApiKey: string) {
  const row = hashListFetchedStatement.get(consoleId) as { fetched_at: string } | undefined;
  const fresh = row && Date.now() - new Date(row.fetched_at).getTime() < HASH_LIST_TTL_MS;
  if (fresh) return;
  // A failed refresh keeps serving the previous list if there is one.
  let refresh = hashListRefreshes.get(consoleId);
  if (!refresh) {
    refresh = refreshHashList(consoleId, webApiKey).finally(() => hashListRefreshes.delete(consoleId));
    hashListRefreshes.set(consoleId, refresh);
  }
  try {
    await refresh;
  } catch (error) {
    if (!row) throw error;
  }
}

// --- links + catalogue ------------------------------------------------------------------------

const getLinkStatement = db.prepare(
  "SELECT ra_game_id FROM ra_game_links WHERE shop = ? AND object_id = ?"
);
const upsertLinkStatement = db.prepare(`
  INSERT INTO ra_game_links (shop, object_id, ra_game_id, linked_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(shop, object_id) DO UPDATE SET ra_game_id = excluded.ra_game_id, linked_at = excluded.linked_at
`);
export function getLinkedRaGameId(shop: string, objectId: string): number | null {
  const row = getLinkStatement.get(shop, objectId) as { ra_game_id: number } | undefined;
  return row?.ra_game_id ?? null;
}

const catalogueAgeStatement = db.prepare(
  `SELECT MIN(cached_at) AS cached_at, COUNT(*) AS total, COUNT(global_unlock_percent) AS withRarity
   FROM achievement_catalogue WHERE shop = ? AND object_id = ?`
);
const upsertRaAchievementStatement = db.prepare(`
  INSERT INTO achievement_catalogue (shop, object_id, name, display_name, description, icon, icongray, hidden, points, global_unlock_percent, retroachievements_game_id, cached_at, lang)
  VALUES ($shop, $objectId, $name, $displayName, $description, $icon, $icongray, 0, $points, $percent, $raGameId, $cachedAt, 'english')
  ON CONFLICT(shop, object_id, name) DO UPDATE SET
    display_name = excluded.display_name, description = excluded.description, icon = excluded.icon,
    icongray = excluded.icongray, points = excluded.points,
    global_unlock_percent = excluded.global_unlock_percent, retroachievements_game_id = excluded.retroachievements_game_id, cached_at = excluded.cached_at
`);

async function ensureCatalogue(shop: string, objectId: string, raGameId: number, webApiKey: string) {
  const age = catalogueAgeStatement.get(shop, objectId) as {
    cached_at: string | null;
    total: number;
    withRarity: number;
  };
  const ageMs = age.cached_at ? Date.now() - new Date(age.cached_at).getTime() : Infinity;
  // A list cached without rarity (older server, or a brand-new set nobody has played yet) is
  // refreshed hourly so trophies get their gold/silver/bronze tier as soon as data exists.
  const ttl = age.withRarity > 0 ? CATALOGUE_TTL_MS : 60 * 60 * 1000;
  if (age.total > 0 && ageMs < ttl) return;

  const game = await raGet<{
    NumDistinctPlayers?: number;
    Achievements?: Record<string, RaApiAchievement>;
  }>(
    "API_GetGameExtended.php",
    { i: raGameId, y: webApiKey }
  );
  const achievements = Object.values(game.Achievements ?? {}).sort(
    (a, b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0) || a.ID - b.ID
  );
  if (achievements.length === 0) return;

  // Rarity drives the profile's gold/silver/bronze split, same as Steam's global percentages.
  const players = Number(game.NumDistinctPlayers) || 0;
  const percentOf = (achievement: RaApiAchievement) =>
    players > 0 && typeof achievement.NumAwarded === "number"
      ? Math.min(100, (achievement.NumAwarded / players) * 100)
      : null;

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const achievement of achievements) {
      const badge = /^[\w-]+$/.test(achievement.BadgeName ?? "") ? achievement.BadgeName : null;
      upsertRaAchievementStatement.run({
        $shop: shop,
        $objectId: objectId,
        $name: String(achievement.ID),
        $displayName: achievement.Title ?? String(achievement.ID),
        $description: achievement.Description ?? "",
        $icon: badge ? `${RA_MEDIA}/${badge}.png` : "",
        $icongray: badge ? `${RA_MEDIA}/${badge}_lock.png` : "",
        $points: achievement.Points ?? null,
        $percent: percentOf(achievement),
        $raGameId: raGameId,
        $cachedAt: now,
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Matches a disc hash to a RetroAchievements game and links it. Null when RA has no such disc. */
export async function resolveRaGameByHash(
  userId: string,
  shop: string,
  objectId: string,
  hash: string,
  consoleId = PS2_CONSOLE_ID
): Promise<{ raGameId: number; title: string | null } | null> {
  const credentials = getRaCredentials(userId);
  if (!credentials) throw new RaNotConnectedError();

  await ensureHashList(consoleId, credentials.web_api_key);
  const match = findHashStatement.get(hash.toLowerCase(), consoleId) as
    | { ra_game_id: number; title: string | null }
    | undefined;
  if (!match) return null;

  upsertLinkStatement.run(shop, objectId, match.ra_game_id, new Date().toISOString());
  await ensureCatalogue(shop, objectId, match.ra_game_id, credentials.web_api_key);
  return { raGameId: match.ra_game_id, title: match.title };
}

export class RaNotConnectedError extends Error {}

/** Keeps a linked game's trophy list fresh (rarity, new sets) using the viewer's own RA key. */
export async function refreshLinkedCatalogue(userId: string, shop: string, objectId: string) {
  const credentials = getRaCredentials(userId);
  const raGameId = getLinkedRaGameId(shop, objectId);
  if (!credentials || !raGameId) return;
  await ensureCatalogue(shop, objectId, raGameId, credentials.web_api_key);
}

const toMillis = (date?: string | null) => {
  if (!date) return null;
  const time = new Date(`${date.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

/** The user's unlocks for a linked game, straight from RetroAchievements. */
export async function fetchRaUnlocks(userId: string, shop: string, objectId: string) {
  const credentials = getRaCredentials(userId);
  const raGameId = getLinkedRaGameId(shop, objectId);
  if (!credentials || !raGameId) return [];

  await ensureCatalogue(shop, objectId, raGameId, credentials.web_api_key);
  const progress = await raGet<{ Achievements?: Record<string, RaApiAchievement> }>(
    "API_GetGameInfoAndUserProgress.php",
    { g: raGameId, u: credentials.username, y: credentials.web_api_key }
  );

  return Object.values(progress.Achievements ?? {}).flatMap((achievement) => {
    const unlockTime = toMillis(achievement.DateEarned ?? achievement.DateEarnedHardcore);
    if (unlockTime == null) return [];
    return [
      {
        name: String(achievement.ID),
        unlockTime,
        hardcoreUnlockTime: toMillis(achievement.DateEarnedHardcore),
      },
    ];
  });
}
