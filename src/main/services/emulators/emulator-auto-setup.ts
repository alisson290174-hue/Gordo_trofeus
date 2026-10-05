import { existsSync } from "node:fs";
import path from "node:path";

import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorSystem, ResolvedInstallOption } from "@types";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import {
  downloadAndInstallAllCores,
  downloadAndInstallRetroArch,
} from "../retroarch/retroarch-core-installer";
import { resolveRetroArchInstallOptions } from "../retroarch/retroarch-install-sources";
import {
  getRetroArchConfig,
  updateRetroArchConfig,
} from "../retroarch/retroarch-repository";
import { detectEmulatorWithDownloads } from "./detect-emulator-with-downloads";
import {
  downloadAndInstallEmulator,
  resolveEmulatorInstallOptions,
} from "./emulator-installer";
import {
  getEmulatorConfig,
  updateEmulatorConfig,
} from "./emulators-repository";
import { getEmulatorVersion } from "./get-emulator-version";
import { KNOWN_BINARIES } from "./known-binaries";
import { installPs3FirmwareIfMissing } from "./ps3-firmware-installer";
import { configureControllerForEmulator } from "./controller-autoconfig";
import { applyGraphicsProfile, applySmoothShaders } from "./graphics-profile";
import fs from "node:fs";
import { setIniValue } from "./duckstation-souvenir-config-value";
import {
  duckstationConfigCandidates,
  findExistingConfig,
} from "./emulator-config";

/**
 * RetroAchievements is off by default in RetroArch and DuckStation: turn it on so trophies unlock
 * (the user still signs in once inside the emulator; Opus never handles the RA password).
 */
const enableEmulatorAchievements = (
  target: "ps1" | "retroarch",
  executablePath: string
) => {
  try {
    if (target === "ps1") {
      const file = findExistingConfig(duckstationConfigCandidates());
      if (!file) return;
      const content = fs.readFileSync(file, "utf8");
      if (/^\[Cheevos\][^[]*^Enabled\s*=\s*true/im.test(content)) return;
      fs.writeFileSync(
        file,
        setIniValue(content, "Cheevos", "Enabled", "true"),
        "utf8"
      );
      return;
    }
    const cfg = path.join(path.dirname(executablePath), "retroarch.cfg");
    const content = fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8") : "";
    if (/^cheevos_enable\s*=\s*"true"/m.test(content)) return;
    const next = /^cheevos_enable\s*=.*$/m.test(content)
      ? content.replace(/^cheevos_enable\s*=.*$/m, 'cheevos_enable = "true"')
      : `${content.trimEnd()}${content ? "\n" : ""}cheevos_enable = "true"\n`;
    fs.writeFileSync(cfg, next, "utf8");
  } catch (error) {
    logger.warn("[auto-setup] could not enable achievements", {
      target,
      error: String(error),
    });
  }
};

/**
 * Installs and configures emulators without the user picking anything: anyone with Opus gets
 * working emulators and only has to point it at their own game folders. Each emulator is
 * downloaded from its official release (SHA-256 checked where published), unpacked into the
 * emulators folder and its executable saved in the config. BIOS/keys/firmware are never bundled.
 */
export type AutoSetupStatus =
  "ready" | "found" | "installed" | "unavailable" | "failed";

export interface AutoSetupResult {
  target: EmulatorSystem | "retroarch";
  status: AutoSetupStatus;
  executablePath: string | null;
  reason?: string;
}

const PORTABLE_KINDS = new Set([
  "windows-archive",
  "portable-archive",
  "linux-appimage",
  "macos-dmg",
]);

const sendProgress = (
  result: AutoSetupResult | { target: string; status: "working" }
) =>
  WindowManager.mainWindow?.webContents.send(
    "on-emulator-autosetup-progress",
    result
  );

/** A download that unpacks by itself (never a GUI installer), preferring the "-portable" build. */
export const pickPortableOption = <
  T extends Pick<ResolvedInstallOption, "id" | "downloadUrl"> & {
    kind: string;
  },
>(
  options: T[]
): T | null =>
  options.find(
    (o) =>
      o.downloadUrl && PORTABLE_KINDS.has(o.kind) && o.id.endsWith("-portable")
  ) ??
  options.find((o) => o.downloadUrl && PORTABLE_KINDS.has(o.kind)) ??
  null;

const inFlight = new Map<string, Promise<AutoSetupResult>>();
const once = (key: string, run: () => Promise<AutoSetupResult>) => {
  let pending = inFlight.get(key);
  if (!pending) {
    pending = run().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
};

/** PS3 games need Sony's system software in RPCS3; installed right after the emulator. */
const withPs3Firmware = async (
  result: AutoSetupResult
): Promise<AutoSetupResult> => {
  if (result.target !== "ps3" || !result.executablePath) return result;
  sendProgress({ target: "ps3", status: "working" });
  const firmware = await installPs3FirmwareIfMissing(result.executablePath);
  if (firmware === "failed")
    return { ...result, status: "failed", reason: "ps3_firmware" };
  return firmware === "installed" && result.status === "ready"
    ? { ...result, status: "installed" }
    : result;
};

/** Controller (Xbox layout), graphics for this PC and achievements: everything but the download. */
const configureInstalledEmulator = async (
  system: EmulatorSystem,
  executablePath: string
) => {
  await configureControllerForEmulator(system, executablePath);
  await applyGraphicsProfile(system, executablePath);
  applySmoothShaders(system, executablePath);
  if (system === "ps1") enableEmulatorAchievements("ps1", executablePath);
};

const setupEmulator = async (
  system: EmulatorSystem
): Promise<AutoSetupResult> => {
  const result = await withPs3Firmware(await setupEmulatorBinary(system));
  // "Instala e configura": the Xbox-layout pad is bound right away, not at the first game.
  if (result.executablePath)
    await configureInstalledEmulator(system, result.executablePath);
  return result;
};

const setupEmulatorBinary = async (
  system: EmulatorSystem
): Promise<AutoSetupResult> => {
  const binary = KNOWN_BINARIES[system];
  const config = await getEmulatorConfig(system);
  if (config.executablePath && existsSync(config.executablePath)) {
    return {
      target: system,
      status: "ready",
      executablePath: config.executablePath,
    };
  }

  const save = (
    executablePath: string,
    version: string | null,
    releaseTag: string | null = null
  ) =>
    updateEmulatorConfig(system, (current) => ({
      ...current,
      executablePath,
      detectedVersion: version,
      detectedAt: Date.now(),
      releaseTag,
    }));

  // Already on disk (emulators folder, Downloads, standard install paths)?
  const detected = await detectEmulatorWithDownloads(binary, {
    resolveVersion: false,
  }).catch(() => null);
  if (detected) {
    await save(
      detected.executablePath,
      getEmulatorVersion(detected.executablePath, binary)
    );
    return {
      target: system,
      status: "found",
      executablePath: detected.executablePath,
    };
  }

  sendProgress({ target: system, status: "working" });
  const option = pickPortableOption(
    await resolveEmulatorInstallOptions(binary.binary)
  );
  if (!option)
    return { target: system, status: "unavailable", executablePath: null };

  const result = await downloadAndInstallEmulator(binary.binary, option.id, {
    silent: true,
  });
  if (!result.ok || !result.executablePath) {
    return {
      target: system,
      status: "failed",
      executablePath: null,
      reason: result.reason,
    };
  }
  await save(
    result.executablePath,
    getEmulatorVersion(result.executablePath, binary) ?? option.version,
    option.version ?? null
  );
  return {
    target: system,
    status: "installed",
    executablePath: result.executablePath,
  };
};

const setupRetroArch = async (): Promise<AutoSetupResult> => {
  let config = await getRetroArchConfig();
  let status: AutoSetupStatus = "ready";

  if (!config.executablePath || !existsSync(config.executablePath)) {
    sendProgress({ target: "retroarch", status: "working" });
    const option = pickPortableOption(await resolveRetroArchInstallOptions());
    if (!option)
      return {
        target: "retroarch",
        status: "unavailable",
        executablePath: null,
      };
    const result = await downloadAndInstallRetroArch(option.id, {
      silent: true,
    });
    if (!result.ok) {
      return {
        target: "retroarch",
        status: "failed",
        executablePath: null,
        reason: result.reason,
      };
    }
    status = "installed";
    config = await getRetroArchConfig();
  }

  // Cores live next to RetroArch (its own "cores" folder), so the whole emulator is one folder.
  if (config.executablePath && !config.coresDir) {
    await updateRetroArchConfig((current) => ({
      ...current,
      coresDir: path.join(
        path.dirname(config.executablePath as string),
        "cores"
      ),
    }));
  }
  const missingCores = Object.values((await getRetroArchConfig()).cores).some(
    (core) => !core.installed
  );
  if (missingCores) {
    await downloadAndInstallAllCores();
    if (status === "ready") status = "installed";
  }
  if (config.executablePath)
    enableEmulatorAchievements("retroarch", config.executablePath);
  return { target: "retroarch", status, executablePath: config.executablePath };
};

/** One emulator (used when the user links a game folder for a console with none configured). */
export const autoSetupEmulator = (system: EmulatorSystem) =>
  once(system, async () => {
    try {
      const result = await setupEmulator(system);
      sendProgress(result);
      return result;
    } catch (error) {
      logger.error(`[auto-setup] ${system} failed`, error);
      const result: AutoSetupResult = {
        target: system,
        status: "failed",
        executablePath: null,
      };
      sendProgress(result);
      return result;
    }
  });

export const autoSetupRetroArch = () =>
  once("retroarch", async () => {
    try {
      const result = await setupRetroArch();
      sendProgress(result);
      return result;
    } catch (error) {
      logger.error("[auto-setup] retroarch failed", error);
      const result: AutoSetupResult = {
        target: "retroarch",
        status: "failed",
        executablePath: null,
      };
      sendProgress(result);
      return result;
    }
  });

export type AutoSetupTarget = EmulatorSystem | "retroarch";

/** One emulator picked by the user in Configurações → Emulação. */
export const autoSetupTarget = (target: AutoSetupTarget) =>
  target === "retroarch" ? autoSetupRetroArch() : autoSetupEmulator(target);

export interface EmulatorSetupState {
  target: AutoSetupTarget;
  installed: boolean;
  executablePath: string | null;
}

/** Which emulators are already in place, so each one shows "Instalar" or "Pronto". */
export const getEmulatorSetupStates = async (): Promise<
  EmulatorSetupState[]
> => {
  const states: EmulatorSetupState[] = [];
  for (const system of EMULATOR_SYSTEMS) {
    const config = await getEmulatorConfig(system);
    const installed = Boolean(
      config.executablePath && existsSync(config.executablePath)
    );
    states.push({
      target: system,
      installed,
      executablePath: installed ? config.executablePath : null,
    });
  }
  const retroArch = await getRetroArchConfig();
  const retroArchInstalled =
    Boolean(retroArch.executablePath && existsSync(retroArch.executablePath)) &&
    Object.values(retroArch.cores).every((core) => core.installed);
  states.push({
    target: "retroarch",
    installed: retroArchInstalled,
    executablePath: retroArchInstalled ? retroArch.executablePath : null,
  });
  return states;
};

/** Every emulator Opus supports, one after another (they share bandwidth and disk). */
export const autoSetupAllEmulators = async (): Promise<AutoSetupResult[]> => {
  const results: AutoSetupResult[] = [];
  for (const system of EMULATOR_SYSTEMS)
    results.push(await autoSetupEmulator(system));
  results.push(await autoSetupRetroArch());
  return results;
};

// ---- Separate steps (Configurações → Emulação: "Baixar" and "Configurar" per emulator) ---------

/** Download / install only. */
export const installEmulatorOnly = async (
  target: AutoSetupTarget
): Promise<AutoSetupResult> => {
  try {
    const result =
      target === "retroarch"
        ? await setupRetroArch()
        : await withPs3Firmware(await setupEmulatorBinary(target));
    sendProgress(result);
    return result;
  } catch (error) {
    logger.error(`[auto-setup] install ${target} failed`, error);
    const result: AutoSetupResult = {
      target,
      status: "failed",
      executablePath: null,
    };
    sendProgress(result);
    return result;
  }
};

/** Configure only (the emulator must be installed). */
export const configureEmulatorOnly = async (
  target: AutoSetupTarget
): Promise<boolean> => {
  try {
    if (target === "retroarch") {
      const config = await getRetroArchConfig();
      if (!config.executablePath || !existsSync(config.executablePath))
        return false;
      enableEmulatorAchievements("retroarch", config.executablePath);
      return true;
    }
    const config = await getEmulatorConfig(target);
    if (!config.executablePath || !existsSync(config.executablePath))
      return false;
    await configureInstalledEmulator(target, config.executablePath);
    return true;
  } catch (error) {
    logger.error(`[auto-setup] configure ${target} failed`, error);
    return false;
  }
};

export interface EmulatorVersionInfo {
  target: AutoSetupTarget;
  version: string | null;
}

/** Installed version per emulator, for the cards. */
export const getEmulatorVersions = async (): Promise<EmulatorVersionInfo[]> => {
  const versions: EmulatorVersionInfo[] = [];
  for (const system of EMULATOR_SYSTEMS) {
    const config = await getEmulatorConfig(system);
    versions.push({
      target: system,
      version: config.releaseTag ?? config.detectedVersion ?? null,
    });
  }
  return versions;
};
