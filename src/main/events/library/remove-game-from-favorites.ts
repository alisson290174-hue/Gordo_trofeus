import { registerEvent } from "../register-event";
import { isLocalOnlyShop } from "@shared";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const removeGameFromFavorites = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  if (!isLocalOnlyShop(shop)) {
    HydraApi.put(`/profile/games/${shop}/${objectId}/unfavorite`).catch(
      () => {}
    );
  }

  try {
    await gamesSublevel.put(gameKey, {
      ...game,
      favorite: false,
    });
  } catch (error) {
    throw new Error(`Failed to update game favorite status: ${error}`);
  }
};

registerEvent("removeGameFromFavorites", removeGameFromFavorites);
