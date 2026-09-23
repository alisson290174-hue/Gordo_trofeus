import { db } from "../db.js";
import { config } from "../config.js";
import { getOrCacheSteamGame } from "./steam-lookup.js";

// ~20 appdetails calls/min (100/5min) — well under Steam's informal ~200/5min limit, leaving
// headroom for real-time traffic (search, game pages, download-source matching) that shares the
// same soft limit. At this pace, ingesting Steam's ~150k-app list takes roughly a week; that's
// fine for a background job that only needs to run once.
const BATCH_SIZE = 20;
const BATCH_INTERVAL_MS = 60_000;
const REQUEST_GAP_MS = 300;

interface AppListEntry {
  appid: number;
  name: string;
}

interface GetAppListResponse {
  response?: {
    apps?: AppListEntry[];
    have_more_results?: boolean;
    last_appid?: number;
  };
}

const APP_LIST_PAGE_SIZE = 50_000;

/** Fetches one page of IStoreService/GetAppList, pre-filtered to real games only (skips DLC,
 * software, soundtracks, videos, hardware at the source instead of wasting appdetails calls on
 * them later). Replaces the old ISteamApps/GetAppList/v2, which Valve has since removed (404). */
async function fetchAppListPage(lastAppId: number): Promise<GetAppListResponse["response"]> {
  const url = new URL("https://api.steampowered.com/IStoreService/GetAppList/v1/");
  url.searchParams.set("key", config.steamApiKey);
  url.searchParams.set("include_games", "true");
  url.searchParams.set("include_dlc", "false");
  url.searchParams.set("include_software", "false");
  url.searchParams.set("include_videos", "false");
  url.searchParams.set("include_hardware", "false");
  url.searchParams.set("max_results", String(APP_LIST_PAGE_SIZE));
  if (lastAppId > 0) url.searchParams.set("last_appid", String(lastAppId));

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = (await response.json()) as GetAppListResponse;
  return data.response ?? {};
}

const getStateStatement = db.prepare("SELECT value FROM sync_state WHERE key = ?");
const setStateStatement = db.prepare(
  `INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);

const insertQueueEntryStatement = db.prepare(
  `INSERT INTO steam_appid_sync_queue (appid, name, status, updated_at)
   VALUES ($appid, $name, 'pending', $updatedAt)
   ON CONFLICT(appid) DO NOTHING`
);
const nextPendingBatchStatement = db.prepare(
  `SELECT appid FROM steam_appid_sync_queue WHERE status = 'pending' ORDER BY appid ASC LIMIT ?`
);
const markQueueStatusStatement = db.prepare(
  `UPDATE steam_appid_sync_queue SET status = ?, updated_at = ? WHERE appid = ?`
);
const countPendingStatement = db.prepare(
  `SELECT COUNT(*) as total FROM steam_appid_sync_queue WHERE status = 'pending'`
);

function insertAppListPage(apps: AppListEntry[]): void {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const app of apps) {
      if (!app.name || !app.appid) continue;
      insertQueueEntryStatement.run({ appid: app.appid, name: app.name, updatedAt: now });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** One-time seed: pulls Steam's full game list into a queue table so the sync loop can work
 * through it gradually across restarts instead of re-fetching the list every boot. */
export async function seedAppIdQueueIfNeeded(): Promise<void> {
  const seeded = getStateStatement.get("steam_appid_queue_seeded") as { value: string } | undefined;
  if (seeded) return;

  try {
    let lastAppId = 0;
    let pageCount = 0;
    for (;;) {
      const page = await fetchAppListPage(lastAppId);
      const apps = page?.apps ?? [];
      if (apps.length > 0) insertAppListPage(apps);
      pageCount++;

      if (!page?.have_more_results || !page.last_appid) break;
      lastAppId = page.last_appid;
      // GetAppList's own rate limit is separate from (and much more generous than) appdetails',
      // but there's no reason to hammer it — a short gap between pages is plenty.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    setStateStatement.run("steam_appid_queue_seeded", new Date().toISOString());
    console.log(`Steam appid sync queue seeded across ${pageCount} page(s).`);
  } catch (error) {
    // Not fatal — the catalogue still works off whatever's already cached; the next restart
    // retries the seed since the state flag was never set.
    console.error("Failed to seed the Steam appid sync queue:", error);
  }
}

const requeueUntranslatedStatement = db.prepare(`
  INSERT INTO steam_appid_sync_queue (appid, name, status, updated_at)
  SELECT appid, title, 'pending', $updatedAt FROM steam_games WHERE lang IS NULL OR lang != 'brazilian'
  ON CONFLICT(appid) DO UPDATE SET status = 'pending'
`);

/** One-time migration: games cached before Portuguese support (matched via download sources,
 * before the full-catalogue sync existed) would otherwise sit in English forever — the bulk
 * listing queries (search, hot, weekly) read steam_games directly and don't go through
 * getOrCacheSteamGame, so nothing would ever re-fetch them on its own. Re-queuing them lets the
 * regular sync loop pick them up and translate them like any other pending appid. */
export function requeueUntranslatedGamesIfNeeded(): void {
  const done = getStateStatement.get("untranslated_games_requeued") as { value: string } | undefined;
  if (done) return;

  requeueUntranslatedStatement.run({ updatedAt: new Date().toISOString() });
  setStateStatement.run("untranslated_games_requeued", new Date().toISOString());
}

let batchInFlight = false;

async function processSyncBatch(): Promise<void> {
  if (batchInFlight) return;
  batchInFlight = true;

  try {
    const rows = nextPendingBatchStatement.all(BATCH_SIZE) as { appid: number }[];

    for (const { appid } of rows) {
      const now = new Date().toISOString();
      try {
        const game = await getOrCacheSteamGame(appid);
        markQueueStatusStatement.run(game ? "done" : "skipped", now, appid);
      } catch {
        markQueueStatusStatement.run("skipped", now, appid);
      }
      await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
    }
  } finally {
    batchInFlight = false;
  }
}

export function startSteamCatalogueSyncLoop(): void {
  setInterval(() => {
    void processSyncBatch();
  }, BATCH_INTERVAL_MS);
}

export function getSyncQueueStatus(): { pending: number } {
  const { total } = countPendingStatement.get() as { total: number };
  return { pending: total };
}
