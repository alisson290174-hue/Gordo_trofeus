import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
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
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const feed = await response.json();
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
          uris: JSON.stringify(entry.uris),
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

export function registerDownloadSourceRoutes(app: FastifyInstance) {
  app.post<{ Body: { url?: string } }>("/download-sources", async (request, reply) => {
    const url = request.body?.url;
    if (!url) return reply.code(400).send({ message: "url is required" });

    try {
      new URL(url);
    } catch {
      return reply.code(400).send({ message: "Invalid URL" });
    }

    // Sources are shared/global (matching work is expensive) — reuse an existing entry for the same URL.
    const existing = getSourceByUrlStatement.get(url) as unknown as DownloadSourceRow | undefined;
    if (existing) return reply.send(toDownloadSourceResponse(existing));

    const id = crypto.randomUUID();
    insertSourceStatement.run(id, url, null, new Date().toISOString());

    // Fire-and-forget: the client polls the routes below every 5s to see the status update.
    void processDownloadSource(id, url);

    const row = getSourceStatement.get(id) as unknown as DownloadSourceRow;
    reply.send(toDownloadSourceResponse(row));
  });

  app.get("/download-sources", async (_request, reply) => {
    const rows = listSourcesStatement.all() as unknown as DownloadSourceRow[];
    reply.send(rows.map(toDownloadSourceResponse));
  });

  app.get<{ Params: { id: string } }>("/download-sources/:id", async (request, reply) => {
    const row = getSourceStatement.get(request.params.id) as unknown as DownloadSourceRow | undefined;
    if (!row) return reply.code(404).send({ message: "Download source not found" });
    reply.send(toDownloadSourceResponse(row));
  });
}
