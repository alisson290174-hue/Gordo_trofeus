import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { fileTypeFromFile } from "file-type";
import type { Readable } from "node:stream";
import type { GameShop } from "@types";
import { displayGameTitle } from "@shared";
import { ASSETS_PATH } from "@main/constants";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import {
  MAX_ARTWORK_SIZE_IN_BYTES,
  validateArtworkContentLength,
  writeArtworkStream,
} from "@main/events/library/download-game-artwork-stream";
import { applyGameCustomAssets } from "@main/events/library/update-game-custom-assets";

/**
 * "Buscar capa e informações": asks our server for the game's official Steam art, downloads the
 * pieces this game is missing (or whose link is dead) and applies them like the Customize screen
 * does — saved on this PC (local:) so no sync can wipe them, and backed up with the custom art.
 */
interface ArtworkLookup {
  appId: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
}

export type FindArtworkResult =
  | { status: "applied"; matchedTitle: string; applied: ArtworkSlot[] }
  | { status: "complete"; matchedTitle: string }
  | { status: "not-found" }
  | { status: "unsupported" };

type ArtworkSlot = "cover" | "hero" | "logo" | "icon";

const SLOTS = [
  { slot: "cover", field: "customCoverImageUrl", asset: "grid", from: "coverUrl" },
  { slot: "hero", field: "customHeroImageUrl", asset: "hero", from: "heroUrl" },
  { slot: "logo", field: "customLogoImageUrl", asset: "logo", from: "logoUrl" },
  { slot: "icon", field: "customIconUrl", asset: "icon", from: "iconUrl" },
] as const;

// Steam's image hosts only — the server never returns anything else, and we don't trust more.
const ALLOWED_HOSTS = ["shared.steamstatic.com", "cdn.cloudflare.steamstatic.com"];

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const isAllowedImageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
};

/** Whether what the game shows today actually loads. */
async function isWorking(url: string | null | undefined) {
  if (!url) return false;
  if (url.startsWith("local:")) return fs.existsSync(url.slice("local:".length));
  if (!/^https?:\/\//.test(url)) return false;
  const response = await axios
    .head(url, { timeout: 8000, validateStatus: () => true })
    .catch(() => null);
  return Boolean(response && response.status >= 200 && response.status < 400);
}

async function downloadToAssets(url: string, asset: string): Promise<string | null> {
  if (!isAllowedImageUrl(url)) return null;

  const directory = path.join(ASSETS_PATH, "custom-games");
  await fs.promises.mkdir(directory, { recursive: true });
  const base = path.join(directory, `${asset}-${randomUUID()}`);
  const partial = `${base}.download`;

  try {
    const response = await axios.get<Readable>(url, {
      responseType: "stream",
      timeout: 30_000,
      maxRedirects: 0,
    });
    validateArtworkContentLength(response.headers["content-length"]);
    await writeArtworkStream(response.data, partial, MAX_ARTWORK_SIZE_IN_BYTES);

    // Trust the bytes, not the URL: only real images are kept.
    const type = await fileTypeFromFile(partial);
    const extension = type?.mime ? EXTENSION_BY_MIME[type.mime] : undefined;
    if (!extension) throw new Error("not an image");

    const finalPath = `${base}.${extension}`;
    await fs.promises.rename(partial, finalPath);
    return `local:${finalPath}`;
  } catch (error) {
    await fs.promises.unlink(partial).catch(() => {});
    logger.warn("[artwork-finder] download failed", url, (error as Error)?.message ?? error);
    return null;
  }
}

export async function findAndApplyGameArtwork(
  shop: GameShop,
  objectId: string
): Promise<FindArtworkResult> {
  // PS2/classics art comes from the PS2 index; matching those by name on Steam would pick the
  // wrong game (a PS2 "God of War" is not the 2018 PC one).
  if (shop === "launchbox") return { status: "unsupported" };

  const key = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(key).catch(() => null);
  if (!game) return { status: "not-found" };

  const lookup = await HydraApi.post<ArtworkLookup>("/games/artwork-lookup", {
    shop,
    objectId,
    title: displayGameTitle(game.title, shop),
  }).catch(() => null);
  if (!lookup) return { status: "not-found" };

  const shopAssets = await gamesShopAssetsSublevel.get(key).catch(() => null);
  const current: Record<ArtworkSlot, string | null | undefined> = {
    cover:
      game.customCoverImageUrl ??
      shopAssets?.coverImageUrl ??
      shopAssets?.libraryImageUrl ??
      game.coverImageUrl,
    hero: game.customHeroImageUrl ?? shopAssets?.libraryHeroImageUrl ?? game.libraryHeroImageUrl,
    logo: game.customLogoImageUrl ?? shopAssets?.logoImageUrl ?? game.logoImageUrl,
    icon: game.customIconUrl ?? shopAssets?.iconUrl ?? game.iconUrl,
  };

  const updates: Partial<Record<(typeof SLOTS)[number]["field"], string>> = {};
  const applied: ArtworkSlot[] = [];

  for (const { slot, field, asset, from } of SLOTS) {
    const found = lookup[from];
    if (!found || (await isWorking(current[slot]))) continue;
    const local = await downloadToAssets(found, asset);
    if (!local) continue;
    updates[field] = local;
    applied.push(slot);
  }

  if (applied.length === 0) return { status: "complete", matchedTitle: lookup.title };

  await applyGameCustomAssets({ shop, objectId, title: game.title, ...updates });
  logger.info(`[artwork-finder] ${shop}:${objectId} → ${lookup.appId} applied ${applied.join(", ")}`);
  return { status: "applied", matchedTitle: lookup.title, applied };
}
