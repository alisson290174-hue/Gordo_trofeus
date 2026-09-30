import type { FastifyInstance } from "fastify";
import { getPs2Metadata, type Ps2Metadata } from "./ps2-index.js";

/** Same id the client gives unmatched ROMs ("rom-sku-SCES50959"), so rescans never duplicate games. */
const objectIdForSku = (sku: string) => `rom-sku-${sku.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;

function toShopDetailsEntry(objectId: string, meta: Ps2Metadata, skus: string[]) {
  return {
    objectId,
    shop: "launchbox",
    platform: "PlayStation 2",
    skus,
    matchedSkus: skus,
    data: {
      title: meta.title,
      platform: "PlayStation 2",
      description: meta.description,
      releaseDate: meta.releaseYear ? String(meta.releaseYear) : null,
      developers: meta.developers,
      publishers: meta.publishers,
      genres: meta.genres,
      headerImage: meta.headerUrl,
      website: null,
      screenshots: meta.screenshots,
      assets: {
        objectId,
        shop: "launchbox",
        title: meta.title,
        iconUrl: null,
        libraryHeroImageUrl: meta.heroUrl,
        libraryImageUrl: meta.coverUrl,
        logoImageUrl: meta.logoUrl,
      },
    },
  };
}

export function registerPs2Routes(app: FastifyInstance) {
  // Used by the game page (objectIds) and by the ROM scanner / memory-card tools (skus).
  app.post<{
    Body: { shop?: string; objectIds?: string[]; skus?: string[]; language?: string };
  }>("/games/shop-details", async (request, reply) => {
    const { shop, objectIds = [], skus = [] } = request.body ?? {};
    if (shop && shop !== "launchbox") return reply.send([]);

    const entries = [];
    for (const objectId of objectIds.slice(0, 200)) {
      const meta = getPs2Metadata(objectId);
      if (meta) entries.push(toShopDetailsEntry(objectId, meta, meta.serial ? [meta.serial] : []));
    }
    for (const sku of skus.slice(0, 200)) {
      const objectId = objectIdForSku(sku);
      const meta = getPs2Metadata(objectId);
      if (meta) entries.push(toShopDetailsEntry(objectId, meta, [sku]));
    }
    reply.send(entries);
  });
}
