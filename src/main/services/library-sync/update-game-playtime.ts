import type { Game } from "@types";
import { isLocalOnlyShop } from "@shared";
import { HydraApi } from "../hydra-api";

export const trackGamePlaytime = async (
  game: Game,
  deltaInMillis: number,
  lastTimePlayed: Date
) => {
  if (isLocalOnlyShop(game.shop)) {
    return;
  }

  return HydraApi.put(`/profile/games/${game.shop}/${game.objectId}`, {
    playTimeDeltaInSeconds: Math.trunc(deltaInMillis / 1000),
    lastTimePlayed,
  });
};
