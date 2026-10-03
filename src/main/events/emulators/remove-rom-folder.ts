import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

import { hideGamesOutsideRomFolders } from "./import-launchbox-roms";

const removeRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderId: string
) => {
  const updated = await emulators.updateEmulatorConfig(system, (current) =>
    emulators.recomputeTotals({
      ...current,
      romFolders: current.romFolders.filter((f) => f.id !== folderId),
    })
  );
  // Unlinking a folder takes its games out of the library too.
  await hideGamesOutsideRomFolders(
    system,
    updated.romFolders.map((f) => f.path)
  );
  return updated;
};

registerEvent("removeRomFolder", removeRomFolder);
