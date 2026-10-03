import { registerEvent } from "../register-event";
import {
  autoSetupAllEmulators,
  autoSetupTarget,
  getEmulatorSetupStates,
  type AutoSetupTarget,
} from "@main/services/emulators/emulator-auto-setup";
import { EMULATOR_SYSTEMS } from "@shared";
import {
  getEmulatorsBaseDir,
  setEmulatorsBaseDir,
} from "@main/services/emulators/emulators-base-dir";

// "Instalar e configurar emuladores": every supported emulator, from official builds.
registerEvent("autoSetupEmulators", () => autoSetupAllEmulators());

// One emulator the user picked: install (official build) and configure it, controller included.
registerEvent("autoSetupEmulator", (_event, target: AutoSetupTarget) => {
  if (target !== "retroarch" && !EMULATOR_SYSTEMS.includes(target)) {
    throw new Error("Unknown emulator");
  }
  return autoSetupTarget(target);
});

registerEvent("getEmulatorSetupStates", () => getEmulatorSetupStates());

registerEvent("getEmulatorsBaseDir", () => getEmulatorsBaseDir());

registerEvent("setEmulatorsBaseDir", (_event, dir: string) => setEmulatorsBaseDir(dir));
