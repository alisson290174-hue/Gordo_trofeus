import { checkEmulatorUpdates } from "@main/services/emulators/emulator-updater";
import { registerEvent } from "../register-event";
import {
  autoSetupAllEmulators,
  autoSetupTarget,
  configureEmulatorOnly,
  getEmulatorVersions,
  installEmulatorOnly,
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

registerEvent("setEmulatorsBaseDir", (_event, dir: string) =>
  setEmulatorsBaseDir(dir)
);

const assertTarget = (target: AutoSetupTarget) => {
  if (target !== "retroarch" && !EMULATOR_SYSTEMS.includes(target))
    throw new Error("Unknown emulator");
  return target;
};

// The two halves of "Instalar e configurar", as separate buttons on each emulator card.
registerEvent("installEmulatorOnly", (_event, target: AutoSetupTarget) =>
  installEmulatorOnly(assertTarget(target))
);
registerEvent("configureEmulatorOnly", (_event, target: AutoSetupTarget) =>
  configureEmulatorOnly(assertTarget(target))
);
registerEvent("getEmulatorVersions", () => getEmulatorVersions());
registerEvent("checkEmulatorUpdates", () => checkEmulatorUpdates());

registerEvent("hasRaEmulatorSession", async () => {
  const { hasRaEmulatorSession } =
    await import("@main/services/emulators/retroachievements-emulator-login");
  return hasRaEmulatorSession();
});

// "Conectar RetroAchievements nos emuladores": one login, a token written into every emulator.
registerEvent(
  "loginRetroAchievementsInEmulators",
  async (_event, username: string, password: string) => {
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !password
    ) {
      return { ok: false as const, reason: "invalid_credentials" as const };
    }
    const { loginRetroAchievementsInEmulators } =
      await import("@main/services/emulators/retroachievements-emulator-login");
    return loginRetroAchievementsInEmulators(username, password);
  }
);
