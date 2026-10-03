import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";

import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorSystem, RomFolder, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { getEmulatorConfig, updateEmulatorConfig } from "./emulators/emulators-repository";
import { getEmulatorsBaseDir, setEmulatorsBaseDir } from "./emulators/emulators-base-dir";
import { getRetroArchConfig, updateRetroArchConfig } from "./retroarch/retroarch-repository";
import {
  looksLikeFreshInstall,
  mergePreferences,
  SETTINGS_SNAPSHOT_VERSION,
  stripSecrets,
  type SettingsSnapshot,
  type SyncedFolder,
} from "./settings-sync-rules";

/**
 * The user's setup lives on our server too: after formatting the PC, a new install signs in and
 * comes back with its preferences, emulators folder and every linked games folder; missing
 * emulators are reinstalled by the usual auto-setup. Uploaded on startup and whenever it changes.
 */

const RESTORED_KEY = "opus:settingsRestored";
const UPLOAD_EVERY = 15 * 60_000;
let lastUploadedHash: string | null = null;
let uploadTimer: ReturnType<typeof setInterval> | null = null;

const existing = (target: string | null | undefined) => (target && fs.existsSync(target) ? target : null);
const folders = (list: { path: string; scanSubfolders: boolean }[]): SyncedFolder[] =>
  list.map((folder) => ({ path: folder.path, scanSubfolders: folder.scanSubfolders }));

const toRomFolder = (folder: SyncedFolder): RomFolder => ({
  id: randomUUID(),
  path: folder.path,
  scanSubfolders: folder.scanSubfolders,
  fileCount: 0,
  sizeBytes: 0,
  lastScanAt: null,
});

const readPreferences = async () =>
  ((await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, { valueEncoding: "json" })
    .catch(() => null)) ?? {}) as Record<string, unknown>;

export const collectSettings = async (): Promise<SettingsSnapshot> => {
  const emulators: SettingsSnapshot["emulators"] = {};
  for (const system of EMULATOR_SYSTEMS as EmulatorSystem[]) {
    const config = await getEmulatorConfig(system);
    emulators[system] = {
      executablePath: config.executablePath,
      biosPath: config.biosPath,
      romFolders: folders(config.romFolders),
    };
  }
  const retroarch = await getRetroArchConfig();
  return {
    version: SETTINGS_SNAPSHOT_VERSION,
    preferences: stripSecrets(await readPreferences()),
    emulatorsBaseDir: await getEmulatorsBaseDir(),
    emulators,
    retroarch: { executablePath: retroarch.executablePath, romFolders: folders(retroarch.romFolders) },
  };
};

const uploadSettings = async () => {
  if (!HydraApi.isLoggedIn()) return;
  const snapshot = await collectSettings();
  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  if (hash === lastUploadedHash) return;
  await HydraApi.put("/profile/settings", { settings: snapshot });
  lastUploadedHash = hash;
};

/** Brings the server copy into a fresh install (only once, and only if nothing is set up yet). */
const restoreSettings = async (): Promise<boolean> => {
  const alreadyRestored = await db.get<string, string>(RESTORED_KEY, { valueEncoding: "utf8" }).catch(() => null);
  if (alreadyRestored) return false;
  const local = await collectSettings();
  if (!looksLikeFreshInstall(local)) {
    await db.put(RESTORED_KEY, new Date().toISOString(), { valueEncoding: "utf8" });
    return false;
  }
  const remote = await HydraApi.get<{ settings: SettingsSnapshot } | null>("/profile/settings");
  const snapshot = remote?.settings;
  if (!snapshot || snapshot.version !== SETTINGS_SNAPSHOT_VERSION) return false;

  await db.put(levelKeys.userPreferences, mergePreferences(await readPreferences(), snapshot.preferences), {
    valueEncoding: "json",
  });
  if (existing(snapshot.emulatorsBaseDir)) await setEmulatorsBaseDir(snapshot.emulatorsBaseDir as string);

  for (const [system, saved] of Object.entries(snapshot.emulators)) {
    if (!(EMULATOR_SYSTEMS as string[]).includes(system)) continue;
    const romFolders = saved.romFolders.filter((folder) => fs.existsSync(folder.path));
    await updateEmulatorConfig(system as EmulatorSystem, (current) => ({
      ...current,
      executablePath: current.executablePath ?? existing(saved.executablePath),
      biosPath: current.biosPath ?? existing(saved.biosPath),
      romFolders: current.romFolders.length ? current.romFolders : romFolders.map(toRomFolder),
    }));
  }
  if (snapshot.retroarch) {
    const retroFolders = snapshot.retroarch.romFolders.filter((folder) => fs.existsSync(folder.path));
    await updateRetroArchConfig((current) => ({
      ...current,
      executablePath: current.executablePath ?? existing(snapshot.retroarch?.executablePath),
      romFolders: current.romFolders.length ? current.romFolders : retroFolders.map(toRomFolder),
    }));
  }
  await db.put(RESTORED_KEY, new Date().toISOString(), { valueEncoding: "utf8" });
  logger.info("[settings-sync] restored the user's setup from the server");
  return true;
};

export const SettingsSync = {
  /** On startup, once signed in: restore a fresh install, then keep the server copy current. */
  async start() {
    if (!HydraApi.isLoggedIn()) return;
    try {
      const restored = await restoreSettings();
      if (restored) {
        const { autoSetupAllEmulators } = await import("./emulators/emulator-auto-setup");
        void autoSetupAllEmulators();
      }
    } catch (error) {
      logger.warn("[settings-sync] restore failed", error);
    }
    await uploadSettings().catch((error) => logger.warn("[settings-sync] upload failed", error));
    uploadTimer ??= setInterval(() => void uploadSettings().catch(() => {}), UPLOAD_EVERY);
  },
  /** After a settings change the user made (preferences, folders): push soon. */
  touch() {
    setTimeout(() => void uploadSettings().catch(() => {}), 5_000);
  },
};
