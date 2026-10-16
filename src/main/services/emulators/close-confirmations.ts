import fs from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import { setIniValue } from "./duckstation-souvenir-config-value";
import { setQtIniValue } from "./controller-autoconfig-rules";
import { qtEmulatorDataDir } from "./controller-autoconfig";
import { dolphinUserDirectoryCandidates } from "./emulator-log-paths";
import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";

/**
 * Opus closes a game by asking the emulator to quit (like the window's X), so it saves first.
 * An "are you sure?" box would leave that request hanging until it is ended by force, so the
 * close confirmations are turned off: Eden/Azahar (Qt), PCSX2, DuckStation, Dolphin, RPCS3.
 * Their own "new version available" checks go too: Opus updates the emulators by itself (daily),
 * and an updater window at game start can only be dismissed with the mouse in Big Picture.
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
        const file = path.join(
          qtEmulatorDataDir(executablePath, "eden"),
          "config",
          "qt-config.ini"
        );
        // Eden ConfirmStop: 0 ask always, 1 ask per game, 2 never.
        return editFile(file, (c) =>
          setQtIniValue(
            setQtIniValue(
              setQtIniValue(c, "UI", "confirmStop", "2"),
              "UI",
              "confirmClose",
              "false"
            ),
            "UI",
            "check_for_updates",
            "false"
          )
        );
      }
      case "3ds": {
        const file = path.join(
          qtEmulatorDataDir(executablePath, "Azahar"),
          "config",
          "qt-config.ini"
        );
        // Also hides an idle mouse pointer over the game (played with a controller).
        return editFile(file, (c) =>
          setQtIniValue(
            setQtIniValue(
              setQtIniValue(c, "UI", "confirmClose", "false"),
              "UI",
              "hideInactiveMouse",
              "true"
            ),
            "Miscellaneous",
            "check_for_update_on_start",
            "false"
          )
        );
      }
      case "ps2": {
        const file = findExistingConfig(pcsx2ConfigCandidates(executablePath));
        return file
          ? editFile(file, (c) =>
              setIniValue(
                setIniValue(
                  setIniValue(c, "UI", "ConfirmShutdown", "false"),
                  "UI",
                  "HideMouseCursor",
                  "true"
                ),
                "AutoUpdater",
                "CheckAtStartup",
                "false"
              )
            )
          : false;
      }
      case "ps1": {
        const file = findExistingConfig(duckstationConfigCandidates());
        return file
          ? editFile(file, (c) =>
              setIniValue(
                setIniValue(
                  setIniValue(c, "Main", "ConfirmPowerOff", "false"),
                  "Main",
                  "HideCursorInFullscreen",
                  "true"
                ),
                "AutoUpdater",
                "CheckAtStartup",
                "false"
              )
            )
          : false;
      }
      case "dolphin": {
        const userDir = dolphinUserDirectoryCandidates(executablePath)[0];
        if (!userDir) return false;
        return editFile(path.join(userDir, "Config", "Dolphin.ini"), (c) =>
          // An empty update track: Dolphin never offers its own updater window.
          setIniValue(
            setIniValue(c, "Interface", "ConfirmStop", "False"),
            "AutoUpdate",
            "UpdateTrack",
            ""
          )
        );
      }
      case "ps3": {
        const file = path.join(
          path.dirname(executablePath),
          "GuiConfigs",
          "CurrentSettings.ini"
        );
        return editFile(file, (c) =>
          setIniValue(
            setIniValue(c, "Meta", "confirmationBoxExitGame", "false"),
            "Meta",
            "checkUpdateStart",
            "false"
          )
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
