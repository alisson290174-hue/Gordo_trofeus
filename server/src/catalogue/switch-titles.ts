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

// --- lookup by name (dumps whose file has no Title ID, e.g. most .xci) ------------------------

const NINTENDO_SEARCH = "https://searching.nintendo-europe.com/en/select";
const NINTENDO_IMAGE_HOSTS = new Set(["www.nintendo.com", "fs-prod-cdn.nintendo-europe.com"]);

db.exec(`
  CREATE TABLE IF NOT EXISTS switch_title_search (
    query TEXT PRIMARY KEY,
    data TEXT,
    fetched_at TEXT NOT NULL
  )
`);
const getSearchRow = db.prepare("SELECT data, fetched_at FROM switch_title_search WHERE query = ?");
const putSearchRow = db.prepare(
  "INSERT OR REPLACE INTO switch_title_search (query, data, fetched_at) VALUES (?, ?, ?)"
);

/** "Pokémon™ Legends: Arceus" and "Pokemon Legends Arceus" → "pokemonlegendsarceus". */
export const compactSwitchTitle = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]/g, "");

const nintendoImage = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (!NINTENDO_IMAGE_HOSTS.has(url.hostname)) return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
};

export interface SwitchSearchResult {
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  releaseYear: number | null;
}

interface NintendoDoc {
  title?: string;
  image_url_sq_s?: string;
  image_url?: string;
  image_url_h2x1_s?: string;
  pretty_date_s?: string;
}

/**
 * Official Nintendo eShop search, accepted only on an exact (normalised) title match so a dump is
 * never given another game's art. Cached per query, misses included.
 */
export async function searchSwitchByTitle(rawTitle: string): Promise<SwitchSearchResult | null> {
  const wanted = compactSwitchTitle(rawTitle);
  if (wanted.length < 3 || wanted.length > 120) return null;

  const row = getSearchRow.get(wanted) as { data: string | null; fetched_at: string } | undefined;
  if (row?.data) return JSON.parse(row.data) as SwitchSearchResult;
  if (row && Date.now() - new Date(row.fetched_at).getTime() < MISS_TTL_MS) return null;
  if (!upstreamBudget("nintendo-search")) return null;

  try {
    const url = new URL(NINTENDO_SEARCH);
    // Solr query: keep only letters, digits and spaces so user text can't alter the query.
    url.searchParams.set("q", rawTitle.normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ").trim());
    url.searchParams.set("fq", "type:GAME AND system_type:nintendoswitch*");
    url.searchParams.set("rows", "10");
    url.searchParams.set("wt", "json");
    url.searchParams.set("fl", "title,image_url,image_url_sq_s,image_url_h2x1_s,pretty_date_s");
    const response = await fetch(url, {
      headers: { "user-agent": "BaloiServer/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.length > MAX_BYTES) return null;
    const docs = (JSON.parse(body) as { response?: { docs?: NintendoDoc[] } }).response?.docs ?? [];
    const doc = docs.find((d) => typeof d.title === "string" && compactSwitchTitle(d.title) === wanted);

    const year = Number(doc?.pretty_date_s?.slice(-4));
    const result: SwitchSearchResult | null = doc?.title
      ? {
          title: doc.title.replace(/[™®©]/g, "").trim(),
          coverUrl: nintendoImage(doc.image_url_sq_s ?? doc.image_url),
          heroUrl: nintendoImage(doc.image_url_h2x1_s),
          releaseYear: Number.isInteger(year) && year > 2000 ? year : null,
        }
      : null;
    putSearchRow.run(wanted, result ? JSON.stringify(result) : null, new Date().toISOString());
    return result;
  } catch {
    return null;
  }
}
