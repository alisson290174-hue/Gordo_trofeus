import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { findAndApplyGameArtwork } from "@main/services/game-artwork-finder";

const findGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => findAndApplyGameArtwork(shop, objectId);

registerEvent("findGameArtwork", findGameArtwork);
