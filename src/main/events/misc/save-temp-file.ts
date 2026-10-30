import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { registerEvent } from "../register-event";

/** Temp files the renderer may create and later delete (see delete-temp-file.ts). */
export const TEMP_FILE_PREFIX = "hydra-temp-";

const saveTempFile = async (
  _event: Electron.IpcMainInvokeEvent,
  fileName: string,
  fileData: Uint8Array
): Promise<string> => {
  try {
    const tempDir = app.getPath("temp");
    // Only the file name is kept: "..\..\x" would otherwise write outside the temp folder.
    const safeName = path
      .basename(String(fileName))
      .replace(/[<>:"/\\|?*]/g, "_");
    const tempFilePath = path.join(
      tempDir,
      `${TEMP_FILE_PREFIX}${Date.now()}-${safeName}`
    );

    // Write the file data to temp directory
    fs.writeFileSync(tempFilePath, fileData);

    return tempFilePath;
  } catch (error) {
    throw new Error(`Failed to save temp file: ${error}`);
  }
};

registerEvent("saveTempFile", saveTempFile);
