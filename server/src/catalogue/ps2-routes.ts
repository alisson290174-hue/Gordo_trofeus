import type { FastifyInstance } from "fastify";
import { getPs2Metadata, type Ps2Metadata } from "./ps2-index.js";
import { getSwitchMetadata } from "./switch-titles.js";

/** Same id the client gives unmatched ROMs ("rom-sku-SCES50959"), so rescans never duplicate games. */
const objectIdForSku = (sku: string) => `rom-sku-${sku.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;

function toShopDetailsEntry(
  objectId: string,
  meta: Ps2Metadata,
  skus: string[],
  platform = "PlayStation 2"
) {
  return {
    objectId,
    shop: "launchbox",
    platform,
    skus,
    matchedSkus: skus,
    data: {
      title: meta.title,
      platform,
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

    // PS2 comes from the bundled index; Switch Title IDs from the cached nlib lookup.
    const lookup = async (objectId: string) => {
      const ps2 = getPs2Metadata(objectId);
      if (ps2) return { meta: ps2, platform: "PlayStation 2" };
      const nx = await getSwitchMetadata(objectId);
      return nx ? { meta: nx, platform: "Nintendo Switch" } : null;
    };

    const entries = [];
    for (const objectId of objectIds.slice(0, 200)) {
      const found = await lookup(objectId);
      if (found) {
        entries.push(
          toShopDetailsEntry(objectId, found.meta, found.meta.serial ? [found.meta.serial] : [], found.platform)
        );
      }
    }
    for (const sku of skus.slice(0, 200)) {
      const objectId = objectIdForSku(sku);
      const found = await lookup(objectId);
      if (found) entries.push(toShopDetailsEntry(objectId, found.meta, [sku], found.platform));
    }
    reply.send(entries);
  });
}
