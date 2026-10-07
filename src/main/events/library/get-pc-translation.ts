import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import {
  findPcTranslation,
  type PcTranslation,
} from "@main/services/pc-translations";

/** A PC game's kept PT-BR translation/dub files (Traduções\PC\<game>), when there are any. */
const getPcTranslation = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<PcTranslation | null> => {
  if (shop === "launchbox") return null;
  try {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    return game ? await findPcTranslation(game.title) : null;
  } catch (error) {
    logger.warn("[pc-translation] lookup failed", error);
    return null;
  }
};

registerEvent("getPcTranslation", getPcTranslation);
