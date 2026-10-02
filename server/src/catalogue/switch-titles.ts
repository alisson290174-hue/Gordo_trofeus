import { db } from "../db.js";
import { createLimiter } from "../rate-limit.js";
import type { Ps2Metadata } from "./ps2-index.js";

/**
 * Nintendo Switch game info by Title ID (name, publisher, release date, description, icon, banner,
 * screenshots) from the public nlib title API. The app only ever talks to this server; the server
 * fetches over HTTPS from that one fixed host, keeps the result in SQLite (misses too) and serves
 * it from cache to the game page, library and profile.
 */
const NLIB = "https://api.nlib.cc/nx";
const MAX_BYTES = 2 * 1024 * 1024;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_TITLE_ID = /^01[0-9A-F]{11}000$/;

db.exec(`
  CREATE TABLE IF NOT EXISTS switch_titles (
    title_id TEXT PRIMARY KEY,
    data TEXT,
    fetched_at TEXT NOT NULL
  )
`);

const getRow = db.prepare("SELECT data, fetched_at FROM switch_titles WHERE title_id = ?");
const putRow = db.prepare(
  "INSERT OR REPLACE INTO switch_titles (title_id, data, fetched_at) VALUES (?, ?, ?)"
);

// Protects the upstream API (and this VPS's IP) from a flood of uncached lookups.
const upstreamBudget = createLimiter(120, 60_000);

export const switchTitleIdFromObjectId = (objectId: string): string | null => {
  const match = /^rom-sku-(01[0-9A-F]{14})$/i.exec(objectId);
  return match && BASE_TITLE_ID.test(match[1].toUpperCase()) ? match[1].toUpperCase() : null;
};

const toHttps = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.hostname !== "api.nlib.cc") return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : null;

interface NlibTitle {
  id?: string;
  name?: string;
  publisher?: string | null;
  developer?: string | null;
  releaseDate?: string | null;
  description?: string | null;
  category?: string[] | null;
  icon?: string | null;
  banner?: string | null;
  screens?: { screenshots?: string[] } | null;
}

const toMetadata = (titleId: string, raw: NlibTitle): Ps2Metadata | null => {
  const title = text(raw.name, 200)?.replace(/[™®©]/g, "").trim();
  if (!title) return null;
  const year = Number(String(raw.releaseDate ?? "").slice(0, 4));
  const icon = toHttps(raw.icon);
  const banner = toHttps(raw.banner);
  return {
    serial: titleId,
    title,
    releaseYear: Number.isInteger(year) && year > 2000 ? year : null,
    developers: raw.developer ? [text(raw.developer, 120)!] : [],
    publishers: raw.publisher ? [text(raw.publisher, 120)!] : [],
    genres: Array.isArray(raw.category)
      ? raw.category.filter((c): c is string => typeof c === "string").slice(0, 6)
      : [],
    description: text(raw.description, 8000) ?? "",
    coverUrl: icon,
    heroUrl: banner,
    logoUrl: null,
    headerUrl: banner,
    screenshots: (raw.screens?.screenshots ?? [])
      .map(toHttps)
      .filter((url): url is string => Boolean(url))
      .slice(0, 8),
  };
};

/** Cached metadata only (no network) — for synchronous readers like the profile. */
export function getCachedSwitchMetadata(objectId: string): Ps2Metadata | null {
  const titleId = switchTitleIdFromObjectId(objectId);
  if (!titleId) return null;
  const row = getRow.get(titleId) as { data: string | null } | undefined;
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data) as Ps2Metadata;
  } catch {
    return null;
  }
}

async function fetchTitle(titleId: string): Promise<Ps2Metadata | null> {
  const response = await fetch(`${NLIB}/${titleId}`, {
    headers: { "user-agent": "BaloiServer/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`nlib HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error("nlib response too large");
  return toMetadata(titleId, JSON.parse(body) as NlibTitle);
}

/** Cached lookup; fetches once per title (misses are retried weekly). */
export async function getSwitchMetadata(objectId: string): Promise<Ps2Metadata | null> {
  const titleId = switchTitleIdFromObjectId(objectId);
  if (!titleId) return null;

  const row = getRow.get(titleId) as { data: string | null; fetched_at: string } | undefined;
  if (row?.data) return getCachedSwitchMetadata(objectId);
  if (row && Date.now() - new Date(row.fetched_at).getTime() < MISS_TTL_MS) return null;
  if (!upstreamBudget("nlib")) return null;

  try {
    const meta = await fetchTitle(titleId);
    putRow.run(titleId, meta ? JSON.stringify(meta) : null, new Date().toISOString());
    return meta;
  } catch {
    return null; // transient: not cached, retried on the next scan
  }
}
