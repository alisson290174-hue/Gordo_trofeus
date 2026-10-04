import { net } from "electron";

import { db, gamesSublevel } from "@main/level";
import type { Game } from "@types";
import { findAndApplyGameArtwork } from "./game-artwork-finder";
import { logger } from "./logger";

/**
 * Some Steam games (newer store pages) don't publish the standard library_600x900 cover, so they
 * showed an empty card. Once per game, the cover URL is checked; when Steam answers 404 the same
 * "Procurar arte" search the context menu offers runs automatically.
 */

const CHECKED_KEY = "opus:coverRepairChecked";
const CONCURRENCY = 3;

const coverUrlOf = (game: Game) =>
  game.coverImageUrl ??
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900_2x.jpg`;

const isMissing = async (url: string) => {
  try {
    const response = await net.fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return response.status === 404;
  } catch {
    return false; // offline / timeout: try again another day
  }
};

export const repairMissingSteamCovers = async () => {
  const checked = new Set<string>(
    await db.get<string, string[]>(CHECKED_KEY, { valueEncoding: "json" }).catch(() => [] as string[])
  );
  const games: Game[] = [];
  for await (const [, game] of gamesSublevel.iterator()) {
    if (game.shop !== "steam" || game.isDeleted || game.customCoverImageUrl) continue;
    if (checked.has(game.objectId)) continue;
    games.push(game);
  }
  if (games.length === 0) return;

  let repaired = 0;
  const queue = [...games];
  const worker = async () => {
    for (let game = queue.shift(); game; game = queue.shift()) {
      if (await isMissing(coverUrlOf(game))) {
        const result = await findAndApplyGameArtwork(game.shop, game.objectId).catch(() => null);
        if (result?.status === "applied") repaired += 1;
      }
      checked.add(game.objectId);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await db.put(CHECKED_KEY, [...checked], { valueEncoding: "json" });
  if (repaired) logger.info("[covers] replaced missing Steam covers", { repaired });
};
