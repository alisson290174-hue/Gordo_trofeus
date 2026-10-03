import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

import { runLaunchboxImport } from "./import-launchbox-roms";
import { autoInstallTranslations } from "./install-translations-folder";

const addRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean,
  language: string = "en"
) => {
  const current = await emulators.getEmulatorConfig(system);
  if (current.romFolders.some((f) => f.path === folderPath)) {
    return current;
  }

  const signal = { cancelled: false };
  await runLaunchboxImport(
    system,
    [{ path: folderPath, scanSubfolders }],
    language,
    signal
  );
  void autoInstallTranslations(system, [folderPath]);

  return emulators.getEmulatorConfig(system);
};

registerEvent("addRomFolder", addRomFolder);
