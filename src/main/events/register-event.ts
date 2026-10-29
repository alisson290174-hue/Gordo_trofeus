import { app, ipcMain } from "electron";

/**
 * Automated UI tests of the dev build (a fake controller pressing A) must never start a game, an
 * emulator or a fullscreen window on the owner's PC: with OPUS_TEST_BLOCK_LAUNCH=1 these calls
 * only log. Ignored in the installed app.
 */
const BLOCKED_IN_TESTS = new Set([
  "openGame",
  "openClassicsGame",
  "openBigPictureWindow",
  "closeGame",
  "openExternal",
  "installThroughSteam",
  "installEpicGame",
  "restartAndInstallUpdate",
]);
const blockLaunches =
  !app.isPackaged && process.env.OPUS_TEST_BLOCK_LAUNCH === "1";

export const registerEvent = (
  name: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
) => {
  ipcMain.handle(name, async (event: Electron.IpcMainInvokeEvent, ...args) => {
    if (blockLaunches && BLOCKED_IN_TESTS.has(name)) {
      console.log(`[test] blocked ${name}`, JSON.stringify(args).slice(0, 120));
      return null;
    }
    return Promise.resolve(listener(event, ...args)).then((result) => {
      if (!result) return result;
      return JSON.parse(JSON.stringify(result));
    });
  });
};
