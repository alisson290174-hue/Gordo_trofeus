import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { registerEvent } from "../register-event";
import { TEMP_FILE_PREFIX } from "./save-temp-file";

/** Deletes a file made by saveTempFile, and nothing else: any other path is ignored. */
const deleteTempFile = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<void> => {
  try {
    const resolved = path.resolve(String(filePath));
    const isOurs =
      path.dirname(resolved).toLowerCase() ===
        path.resolve(app.getPath("temp")).toLowerCase() &&
      path.basename(resolved).startsWith(TEMP_FILE_PREFIX);
    if (!isOurs) {
      console.warn(
        `Refused to delete a file outside the temp files: ${resolved}`
      );
      return;
    }
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  } catch (error) {
    console.warn(`Failed to delete temp file: ${error}`);
  }
};

registerEvent("deleteTempFile", deleteTempFile);
