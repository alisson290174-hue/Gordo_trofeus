import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";
import { ingestSteamGamesByTitle } from "./steam-lookup.js";

/**
 * "Find cover and info" for a library game. Steam keeps newer art at hashed paths
 * (…/apps/<id>/<hash>/library_capsule.jpg), so the fixed library_600x900 URL 404s for many
 * games; Steam's own store API (IStoreBrowseService/GetItems, public, no key) says where each
 * asset really is. Games from other stores are matched to a Steam app by title first.
 * Only fixed Steam hosts are ever contacted — nothing here fetches a client-supplied URL.
 */
const STORE_API = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/";
const ASSET_BASE = "https://shared.steamstatic.com/store_item_assets/";
const ICON_BASE = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/";

interface StoreItem {
  success?: number;
  appid?: number;
  name?: string;
  basic_info?: { short_description?: string };
  assets?: {
    asset_url_format?: string;
    library_capsule?: string;
    library_capsule_2x?: string;
    library_hero?: string;
    library_hero_2x?: string;
    library_logo?: string;
    library_logo_2x?: string;
    header?: string;
    community_icon?: string;
  };
}

export interface ArtworkLookup {
  appId: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  headerUrl: string | null;
}

/** Lowercase, no accents/marks/punctuation, single spaces — "Watch_Dogs™ 2" → "watch dogs 2". */
export function normalizeTitle(title: string) {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const findByTitleStatement = db.prepare(
  `SELECT appid, title FROM steam_games WHERE title LIKE ? ORDER BY COALESCE(review_count, 0) DESC LIMIT 40`
);

/** Best Steam app for a title: exact normalized match, most reviewed first. No fuzzy guessing. */
function matchAppIdByTitle(title: string): string | null {
  const wanted = normalizeTitle(title);
  if (wanted.length < 2) return null;
  const firstWord = wanted.split(" ")[0];
  const rows = findByTitleStatement.all(`%${firstWord}%`) as { appid: number; title: string }[];
  const exact = rows.find((row) => normalizeTitle(row.title) === wanted);
  return exact ? String(exact.appid) : null;
}

async function headOk(url: string) {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(
    () => null
  );
  return Boolean(response?.ok);
}

async function getStoreItem(appId: string): Promise<StoreItem | null> {
  const input = {
    ids: [{ appid: Number(appId) }],
    context: { language: "brazilian", country_code: "BR" },
    data_request: { include_assets: true, include_basic_info: true },
  };
  const url = `${STORE_API}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    response?: { store_items?: StoreItem[] };
  } | null;
  const item = data?.response?.store_items?.[0];
  return item?.success === 1 ? item : null;
}

async function lookupArtwork(appId: string): Promise<ArtworkLookup | null> {
  const item = await getStoreItem(appId);
  if (!item) return null;

  const assets = item.assets ?? {};
  const format = assets.asset_url_format;
  const assetUrl = (file?: string) =>
    format && file ? ASSET_BASE + format.replace("${FILENAME}", file) : null;

  const candidates = {
    coverUrl: assetUrl(assets.library_capsule_2x ?? assets.library_capsule),
    heroUrl: assetUrl(assets.library_hero_2x ?? assets.library_hero),
    logoUrl: assetUrl(assets.library_logo_2x ?? assets.library_logo),
    headerUrl: assetUrl(assets.header),
    iconUrl: assets.community_icon ? `${ICON_BASE}${appId}/${assets.community_icon}.jpg` : null,
  };

  // Only hand out addresses that really answer — a dead link is worse than none.
  const entries = await Promise.all(
    Object.entries(candidates).map(async ([key, url]) => [key, url && (await headOk(url)) ? url : null])
  );
  const verified = Object.fromEntries(entries) as Record<keyof typeof candidates, string | null>;

  return {
    appId,
    title: item.name ?? appId,
    description: item.basic_info?.short_description ?? null,
    ...verified,
  };
}

export function registerArtworkLookupRoutes(app: FastifyInstance) {
  app.post<{ Body: { shop?: string; objectId?: string; title?: string } }>(
    "/games/artwork-lookup",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const shop = String(request.body?.shop ?? "");
      const objectId = String(request.body?.objectId ?? "");
      const title = String(request.body?.title ?? "").slice(0, 200);

      let appId = shop === "steam" && /^\d{1,10}$/.test(objectId) ? objectId : null;
      if (!appId && title) {
        appId = matchAppIdByTitle(title);
        // Not in the local catalogue yet → pull matches from the Steam store once, then retry.
        if (!appId) {
          const ingested = await ingestSteamGamesByTitle(title).catch(() => 0);
          if (ingested > 0) appId = matchAppIdByTitle(title);
        }
      }
      if (!appId) return reply.code(404).send({ message: "No matching game found" });

      const result = await lookupArtwork(appId);
      if (!result) return reply.code(404).send({ message: "No artwork found" });
      reply.send(result);
    }
  );
}
