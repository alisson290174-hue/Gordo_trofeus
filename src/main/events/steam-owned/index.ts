import { registerEvent } from "../register-event";
import {
  installThroughSteam,
  syncSteamOwnedLibrary,
} from "@main/services/steam-owned/steam-owned-library";

registerEvent("syncSteamOwnedLibrary", () => syncSteamOwnedLibrary());
registerEvent("installThroughSteam", (_event, appId: string) => installThroughSteam(appId));
