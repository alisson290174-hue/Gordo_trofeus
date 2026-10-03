import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

import {
  hideGamesOutsideRomFolders,
  runLaunchboxImport,
} from "./import-launchbox-roms";
import { autoInstallTranslations } from "./install-translations-folder";
import { autoTranslateEmulator } from "./rom-translation-hooks";

const rescanEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  language: string = "en"
) => {
  const current = await emulators.getEmulatorConfig(system);

  if (current.romFolders.length === 0) {
    return emulators.updateEmulatorConfig(system, (cfg) =>
      emulators.recomputeTotals({ ...cfg, romFolders: [] })
    );
  }

  const signal = { cancelled: false };
  await runLaunchboxImport(
    system,
    current.romFolders.map((f) => ({
      path: f.path,
      scanSubfolders: f.scanSubfolders,
    })),
    language,
    signal
  );
  // A full rescan covers every linked folder, so anything left outside them is stale.
  await hideGamesOutsideRomFolders(
    system,
    current.romFolders.map((f) => f.path)
  );
  void autoInstallTranslations(
    system,
    current.romFolders.map((f) => f.path)
  );
  void autoTranslateEmulator(system);

  return emulators.getEmulatorConfig(system);
};

registerEvent("rescanEmulator", rescanEmulator);
