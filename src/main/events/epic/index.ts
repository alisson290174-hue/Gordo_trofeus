import { BrowserWindow } from "electron";
import { registerEvent } from "../register-event";
import {
  getEpicStatus,
  listEpicGames,
  loginToEpic,
  logoutFromEpic,
} from "@main/services/epic/epic-account";
import { syncEpicLibrary } from "@main/services/epic/epic-library";
import {
  cancelEpicInstall,
  getEpicInstalls,
  installEpicGame,
  uninstallEpicGame,
} from "@main/services/epic/epic-installer";
import { logger } from "@main/services";

registerEvent("getEpicStatus", () => getEpicStatus());

registerEvent("loginToEpic", async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const ok = await loginToEpic(parent);
  // Pull the account's games right away so they show up in the library.
  if (ok) void syncEpicLibrary().catch((error) => logger.error("[epic] sync after login failed", error));
  return { ok, status: await getEpicStatus() };
});

registerEvent("logoutFromEpic", async () => {
  await logoutFromEpic();
  return getEpicStatus();
});

registerEvent("listEpicGames", () => listEpicGames());
registerEvent("syncEpicLibrary", () => syncEpicLibrary());
registerEvent("getEpicInstalls", () => getEpicInstalls());
registerEvent("installEpicGame", (_event, appName: string, title: string) =>
  installEpicGame(appName, title)
);
registerEvent("cancelEpicInstall", (_event, appName: string) => cancelEpicInstall(appName));
registerEvent("uninstallEpicGame", (_event, appName: string) => uninstallEpicGame(appName));
