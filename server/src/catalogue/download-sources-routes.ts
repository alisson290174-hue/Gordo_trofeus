import crypto from "node:crypto";
import { requireAuth } from "../auth/require-auth.js";
import { assertSafePublicUrl, safeFetchJson } from "./safe-fetch.js";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { decodeDownloadUri } from "./download-uri.js";
import { matchRepackTitleToSteamGame } from "./matcher.js";

interface SourceEntry {
  title: string;
  uris: string[];
  uploadDate: string | null;
  fileSize: string | null;
}

interface SourceFeed {
  name: string;
  downloads: SourceEntry[];
}

interface DownloadSourceRow {
  id: string;
  url: string;
  name: string | null;
  status: "PENDING_MATCHING" | "MATCHING" | "MATCHED" | "FAILED";
  download_count: number;
  created_at: string;
}

const insertSourceStatement = db.prepare(
  `INSERT INTO download_sources (id, url, name, status, created_at) VALUES (?, ?, ?, 'PENDING_MATCHING', ?)`
);
const getSourceStatement = db.prepare("SELECT * FROM download_sources WHERE id = ?");
const getSourceByUrlStatement = db.prepare("SELECT * FROM download_sources WHERE url = ?");
const listSourcesStatement = db.prepare("SELECT * FROM download_sources ORDER BY created_at DESC");
const setStatusStatement = db.prepare("UPDATE download_sources SET status = ? WHERE id = ?");
const setNameStatement = db.prepare("UPDATE download_sources SET name = ? WHERE id = ?");

const insertRepackStatement = db.prepare(`
  INSERT INTO game_repacks (id, appid, title, file_size, uris, upload_date, download_source_id, created_at)
  VALUES ($id, $appid, $title, $fileSize, $uris, $uploadDate, $downloadSourceId, $createdAt)
`);

const changedRepacksStatement = db.prepare(`
  SELECT appid, download_source_id, COUNT(*) AS total FROM game_repacks
  WHERE created_at > ?
    AND download_source_id IN (SELECT value FROM json_each(?))
    AND appid IN (SELECT value FROM json_each(?))
  GROUP BY appid, download_source_id
`);

function toDownloadSourceResponse(row: DownloadSourceRow) {
  return {
    id: row.id,
    name: row.name ?? row.url,
    url: row.url,
    status: row.status,
    downloadCount: row.download_count,
    createdAt: row.created_at,
  };
}

function isValidFeed(value: unknown): value is SourceFeed {
  if (!value || typeof value !== "object") return false;
  const feed = value as Record<string, unknown>;
  return (
    typeof feed.name === "string" &&
    Array.isArray(feed.downloads) &&
    feed.downloads.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as SourceEntry).title === "string" &&
        Array.isArray((entry as SourceEntry).uris)
    )
  );
}

async function processDownloadSource(sourceId: string, url: string) {
  setStatusStatement.run("MATCHING", sourceId);

  try {
    const feed = await safeFetchJson(url);
    if (!isValidFeed(feed)) throw new Error("Feed does not match the expected schema");

    setNameStatement.run(feed.name, sourceId);

    let matchedCount = 0;
    for (const entry of feed.downloads) {
      // A single bad entry (network hiccup, malformed Steam response) must not abort the whole
      // feed — sources can have thousands of titles, and one failure used to mark all of them lost.
      try {
        const appid = await matchRepackTitleToSteamGame(entry.title);
        if (!appid) continue;

        insertRepackStatement.run({
          id: crypto.randomUUID(),
          appid,
          title: entry.title,
          fileSize: entry.fileSize ?? null,
          uris: JSON.stringify(entry.uris.map(decodeDownloadUri)),
          uploadDate: entry.uploadDate ?? null,
          downloadSourceId: sourceId,
          createdAt: new Date().toISOString(),
        });
        matchedCount++;
      } catch {
        continue;
      }
    }

    setStatusStatement.run(matchedCount > 0 ? "MATCHED" : "FAILED", sourceId);
  } catch {
    setStatusStatement.run("FAILED", sourceId);
  }
}

// At most 10 new sources per user per hour (each one triggers thousands of Steam lookups).
const recentAdds = new Map<string, number[]>();
const allowNewSource = (userId: string) => {
  const hourAgo = Date.now() - 3_600_000;
  const times = (recentAdds.get(userId) ?? []).filter((time) => time > hourAgo);
  if (times.length >= 10) return false;
  times.push(Date.now());
  recentAdds.set(userId, times);
  return true;
};

export function registerDownloadSourceRoutes(app: FastifyInstance) {
  app.post<{ Body: { url?: string } }>("/download-sources", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const url = request.body?.url;
    if (!url || url.length > 2048) return reply.code(400).send({ message: "url is required" });

    // SSRF guard: https only, public addresses only (the server fetches this URL).
    try {
      await assertSafePublicUrl(url);
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message || "Invalid URL" });
    }

    // Sources are shared/global (matching work is expensive) — reuse an existing entry for the same URL.
    const existing = getSourceByUrlStatement.get(url) as unknown as DownloadSourceRow | undefined;
    if (existing) return reply.send(toDownloadSourceResponse(existing));

    if (!allowNewSource(user.id)) {
      return reply.code(429).send({ message: "Too many new sources, try again later" });
    }

    const id = crypto.randomUUID();
    insertSourceStatement.run(id, url, null, new Date().toISOString());

    // Fire-and-forget: the client polls the routes below every 5s to see the status update.
    void processDownloadSource(id, url);

    const row = getSourceStatement.get(id) as unknown as DownloadSourceRow;
    reply.send(toDownloadSourceResponse(row));
  });

  app.get("/download-sources", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const rows = listSourcesStatement.all() as unknown as DownloadSourceRow[];
    reply.send(rows.map(toDownloadSourceResponse));
  });

  /**
   * "New download options" badge: which of the caller's library games got repacks from the given
   * sources since the client's last start. Only Steam app ids are catalogued, other shops are
   * ignored. Inputs are bounded and passed as JSON params (no string-built SQL).
   */
  app.post<{
    Body: { downloadSourceIds?: unknown; games?: unknown; since?: unknown };
  }>("/download-sources/changes", async (request, reply) => {
    if (!requireAuth(request, reply)) return;

    const sourceIds = Array.isArray(request.body?.downloadSourceIds)
      ? request.body.downloadSourceIds.map(String).slice(0, 100)
      : [];
    const games = Array.isArray(request.body?.games) ? request.body.games.slice(0, 5000) : [];
    const appIds = [
      ...new Set(
        games
          .filter((game: { shop?: unknown }) => game?.shop === "steam")
          .map((game: { objectId?: unknown }) => String(game?.objectId ?? ""))
          .filter((id: string) => /^\d{1,10}$/.test(id))
          .map(Number)
      ),
    ];
    const since = new Date(String(request.body?.since ?? ""));
    if (sourceIds.length === 0 || appIds.length === 0 || Number.isNaN(since.getTime())) {
      return reply.send([]);
    }

    const rows = changedRepacksStatement.all(
      since.toISOString(),
      JSON.stringify(sourceIds),
      JSON.stringify(appIds)
    ) as { appid: number; download_source_id: string; total: number }[];

    const byGame = new Map<number, { count: number; sources: string[] }>();
    for (const row of rows) {
      const entry = byGame.get(row.appid) ?? { count: 0, sources: [] };
      entry.count += row.total;
      entry.sources.push(row.download_source_id);
      byGame.set(row.appid, entry);
    }

    reply.send(
      [...byGame].map(([appid, entry]) => ({
        shop: "steam",
        objectId: String(appid),
        newDownloadOptionsCount: entry.count,
        downloadSourceIds: entry.sources,
      }))
    );
  });

  app.get<{ Params: { id: string } }>("/download-sources/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const row = getSourceStatement.get(request.params.id) as unknown as DownloadSourceRow | undefined;
    if (!row) return reply.code(404).send({ message: "Download source not found" });
    reply.send(toDownloadSourceResponse(row));
  });
}
