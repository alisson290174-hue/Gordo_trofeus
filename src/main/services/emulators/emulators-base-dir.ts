import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { db } from "@main/level";

/**
 * Folder where Opus installs emulators it sets up by itself (one subfolder per emulator). Every
 * user gets working emulators without picking anything; they only point Opus at their games.
 * Defaults to a plain ASCII path in the user's home (some emulators dislike accents in paths);
 * the user can move it (e.g. D:\EMULADORES) from the Emulação settings.
 */
const BASE_DIR_KEY = "baloi:emulatorsBaseDir";

export const defaultEmulatorsBaseDir = () =>
  path.join(os.homedir(), "Baloi", "Emuladores");

export async function getEmulatorsBaseDir(): Promise<string> {
  const saved = await db
    .get<string, string>(BASE_DIR_KEY, { valueEncoding: "utf8" })
    .catch(() => null);
  return typeof saved === "string" && path.isAbsolute(saved)
    ? saved
    : defaultEmulatorsBaseDir();
}

export async function setEmulatorsBaseDir(dir: string): Promise<string> {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) {
    throw new Error("The emulators folder must be an absolute path");
  }
  const normalized = path.normalize(dir);
  // Emulators refuse to run from temporary folders (RPCS3 aborts outright), and Windows may
  // clean them up: never install there.
  const temp = path.normalize(os.tmpdir()).toLowerCase();
  if (
    normalized.toLowerCase() === temp ||
    normalized.toLowerCase().startsWith(temp + path.sep)
  ) {
    throw new Error(
      "The emulators folder can't be inside the temporary folder"
    );
  }
  await fs.promises.mkdir(normalized, { recursive: true });
  await db.put(BASE_DIR_KEY, normalized, { valueEncoding: "utf8" });
  return normalized;
}
