import fs from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import { setIniValue } from "./duckstation-souvenir-config-value";
import { setQtIniValue } from "./controller-autoconfig-rules";
import { qtEmulatorDataDir } from "./controller-autoconfig";
import { dolphinUserDirectoryCandidates } from "./emulator-log-paths";
import { findCitronExecutable } from "./switch-emulator-choice";
import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";

/**
 * Opus closes a game by asking the emulator to quit (like the window's X), so it saves first.
 * An "are you sure?" box would leave that request hanging until it is ended by force, so the
 * close confirmations are turned off: Eden/Azahar (Qt), PCSX2, DuckStation, Dolphin, RPCS3.
 */

const editFile = (file: string, edit: (content: string) => string) => {
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const next = edit(content);
  if (next === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, "utf8");
  return true;
};

export const disableCloseConfirmations = (
  system: EmulatorSystem,
  executablePath: string | null
): boolean => {
  if (process.platform !== "win32" || !executablePath) return false;
  try {
    switch (system) {
      case "switch": {
        // Eden ConfirmStop: 0 ask always, 1 ask per game, 2 never. Citron (same yuzu settings)
        // runs some games, so it gets the same treatment.
        const citron = findCitronExecutable(executablePath);
        const files = [
          path.join(
            qtEmulatorDataDir(executablePath, "eden"),
            "config",
            "qt-config.ini"
          ),
          ...(citron
            ? [
                path.join(
                  qtEmulatorDataDir(citron, "citron"),
                  "config",
                  "qt-config.ini"
                ),
              ]
            : []),
        ];
        return files
          .map((file) =>
            editFile(file, (c) =>
              setQtIniValue(
                setQtIniValue(c, "UI", "confirmStop", "2"),
                "UI",
                "confirmClose",
                "false"
              )
            )
          )
          .some(Boolean);
      }
      case "3ds": {
        const file = path.join(
          qtEmulatorDataDir(executablePath, "Azahar"),
          "config",
          "qt-config.ini"
        );
        return editFile(file, (c) =>
          setQtIniValue(c, "UI", "confirmClose", "false")
        );
      }
      case "ps2": {
        const file = findExistingConfig(pcsx2ConfigCandidates(executablePath));
        return file
          ? editFile(file, (c) =>
              setIniValue(c, "UI", "ConfirmShutdown", "false")
            )
          : false;
      }
      case "ps1": {
        const file = findExistingConfig(duckstationConfigCandidates());
        return file
          ? editFile(file, (c) =>
              setIniValue(c, "Main", "ConfirmPowerOff", "false")
            )
          : false;
      }
      case "dolphin": {
        const userDir = dolphinUserDirectoryCandidates(executablePath)[0];
        if (!userDir) return false;
        return editFile(path.join(userDir, "Config", "Dolphin.ini"), (c) =>
          setIniValue(c, "Interface", "ConfirmStop", "False")
        );
      }
      case "ps3": {
        const file = path.join(
          path.dirname(executablePath),
          "GuiConfigs",
          "CurrentSettings.ini"
        );
        return editFile(file, (c) =>
          setIniValue(c, "Meta", "confirmationBoxExitGame", "false")
        );
      }
      default:
        return false;
    }
  } catch (error) {
    logger.warn(
      `[emulator] could not turn off close confirmation for ${system}`,
      error
    );
    return false;
  }
};

/** Once per start: existing installs get the same treatment as a fresh "Configurar". */
export const disableCloseConfirmationsForAll = async (
  getConfig: (
    system: EmulatorSystem
  ) => Promise<{ executablePath: string | null }>
) => {
  for (const system of [
    "switch",
    "3ds",
    "ps2",
    "ps1",
    "dolphin",
    "ps3",
  ] as EmulatorSystem[]) {
    const config = await getConfig(system).catch(() => null);
    if (config?.executablePath)
      disableCloseConfirmations(system, config.executablePath);
  }
};
