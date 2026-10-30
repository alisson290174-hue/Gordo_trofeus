import { shell } from "electron";
import fs from "node:fs";
import { registerEvent } from "../register-event";

/**
 * Opens a folder in Explorer. Only folders: shell.openPath on a file runs it with its default
 * program, so an executable path is refused.
 */
const openFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string
) => {
  const existing = await fs.promises.stat(folderPath).catch(() => null);
  if (existing && !existing.isDirectory()) return "Not a folder";
  await fs.promises.mkdir(folderPath, { recursive: true });
  return shell.openPath(folderPath);
};

registerEvent("openFolder", openFolder);
