import { existsSync } from "node:fs";
import path from "node:path";

import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import { getGamesRunning } from "../process-watcher";
import { WindowManager } from "../window-manager";
import { pickPortableOption } from "./emulator-auto-setup";
import {
  downloadAndInstallEmulator,
  emulatorInstallDirectory,
  resolveEmulatorInstallOptions,
} from "./emulator-installer";
import { decideEmulatorUpdate } from "./emulator-update-rules";
import {
  getEmulatorConfig,
  updateEmulatorConfig,
} from "./emulators-repository";
import { getEmulatorVersion } from "./get-emulator-version";
import { KNOWN_BINARIES } from "./known-binaries";

const DAY = 24 * 60 * 60 * 1000;
let running = false;

const isInside = (child: string, parent: string) => {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

/**
 * Keeps the emulators Opus manages on their latest official release. Only emulators living in the
 * Opus emulators folder are touched (the archive is extracted over the old files, so settings,
 * saves and firmware next to the executable stay), never while a game is open, and every download
 * goes through the same signed/hash-checked path as a first install.
 */
export const checkEmulatorUpdates = async (): Promise<string[]> => {
  if (running || process.platform !== "win32") return [];
  running = true;
  const updated: string[] = [];
  try {
    for (const system of EMULATOR_SYSTEMS as EmulatorSystem[]) {
      if (getGamesRunning().length > 0) break;
      const config = await getEmulatorConfig(system);
      if (!config.executablePath || !existsSync(config.executablePath))
        continue;
      const binary = KNOWN_BINARIES[system];
      if (
        !isInside(
          config.executablePath,
          await emulatorInstallDirectory(binary.binary)
        )
      )
        continue;

      const option = pickPortableOption(
        await resolveEmulatorInstallOptions(binary.binary).catch(() => [])
      );
      if (!option?.version) continue;
      const decision = decideEmulatorUpdate({
        installedTag: config.releaseTag,
        installedVersion: config.detectedVersion,
        latestTag: option.version,
      });
      if (decision === "up_to_date") continue;
      if (decision === "adopt") {
        await updateEmulatorConfig(system, (current) => ({
          ...current,
          releaseTag: option.version,
        }));
        continue;
      }

      logger.info("[emulator-update] updating", {
        system,
        from: config.releaseTag ?? config.detectedVersion,
        to: option.version,
      });
      const result = await downloadAndInstallEmulator(
        binary.binary,
        option.id,
        { silent: true }
      );
      if (!result.ok || !result.executablePath) {
        logger.warn("[emulator-update] update failed", {
          system,
          reason: result.reason,
        });
        continue;
      }
      const executablePath = result.executablePath;
      await updateEmulatorConfig(system, (current) => ({
        ...current,
        executablePath,
        detectedVersion:
          getEmulatorVersion(executablePath, binary) ?? option.version,
        detectedAt: Date.now(),
        releaseTag: option.version,
      }));
      updated.push(`${binary.displayName} ${option.version}`);
    }
  } catch (error) {
    logger.warn("[emulator-update] check failed", error);
  } finally {
    running = false;
  }
  if (updated.length) {
    WindowManager.sendToAppWindows("on-emulators-updated", updated);
  }
  return updated;
};

/** A first check a little after startup, then once a day. */
export const scheduleEmulatorUpdates = () => {
  setTimeout(() => void checkEmulatorUpdates(), 90_000);
  setInterval(() => void checkEmulatorUpdates(), DAY);
};
