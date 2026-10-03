import { registerEvent } from "../register-event";
import { autoSetupAllEmulators } from "@main/services/emulators/emulator-auto-setup";
import {
  getEmulatorsBaseDir,
  setEmulatorsBaseDir,
} from "@main/services/emulators/emulators-base-dir";

// "Instalar e configurar emuladores": every supported emulator, from official builds.
registerEvent("autoSetupEmulators", () => autoSetupAllEmulators());

registerEvent("getEmulatorsBaseDir", () => getEmulatorsBaseDir());

registerEvent("setEmulatorsBaseDir", (_event, dir: string) => setEmulatorsBaseDir(dir));
