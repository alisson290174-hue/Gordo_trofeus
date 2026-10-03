import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import {
  applyQtPadBindings,
  applySdlPadBindings,
  azaharBindings,
  DOLPHIN_GCPAD,
  DOLPHIN_WIIMOTE,
  DUCKSTATION_PAD,
  edenBindings,
  parseXInputHardwareId,
  PCSX2_PAD,
  RPCS3_XINPUT_PLAYER1,
  setQtIniValue,
  shouldWriteDolphinPad,
  shouldWriteRpcs3Input,
  type XInputPad,
} from "./controller-autoconfig-rules";
import { dolphinUserDirectoryCandidates } from "./emulator-log-paths";
import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";

/**
 * Xbox-layout controller set up in every emulator, so a pad plugged in plays without opening any
 * emulator's input screen. Index-based emulators (PCSX2, DuckStation, RPCS3, Dolphin) bind "pad 1"
 * through SDL/XInput; Eden and Azahar pin bindings to the pad's SDL GUID, which Windows exposes
 * through the device's VID/PID/REV. A mapping the user already made for a controller is never
 * touched: only keyboard-only (default) or missing configs are written.
 */

let padCache: { at: number; pad: XInputPad | null } | null = null;

/** First Xbox-class (XInput) controller plugged in, read from Windows' device list. */
export const detectXInputPad = async (): Promise<XInputPad | null> => {
  if (process.platform !== "win32") return null;
  if (padCache && Date.now() - padCache.at < 60_000) return padCache.pad;
  const script =
    "Get-PnpDevice -PresentOnly -Class XnaComposite,XboxComposite -ErrorAction SilentlyContinue | " +
    "ForEach-Object { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_HardwareIds).Data }";
  const output = await new Promise<string>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 15_000 },
      (_error, stdout) => resolve(stdout ?? "")
    );
  });
  const pad =
    output
      .split(/\r?\n/)
      .map((line) => parseXInputHardwareId(line.trim()))
      .find((candidate): candidate is XInputPad => candidate !== null) ?? null;
  padCache = { at: Date.now(), pad };
  return pad;
};

// ---- DuckStation / PCSX2 (SDL pad index 0) ------------------------------------------------------

const writeIfChanged = (filePath: string, transform: (content: string) => string): boolean => {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const next = transform(content);
  if (next === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, "utf8");
  return true;
};

const configureDuckStation = () => {
  const configPath =
    findExistingConfig(duckstationConfigCandidates()) ?? duckstationConfigCandidates()[0];
  return writeIfChanged(configPath, (content) => applySdlPadBindings(content, DUCKSTATION_PAD));
};

const configurePcsx2 = (executablePath: string) => {
  const candidates = pcsx2ConfigCandidates(executablePath);
  const configPath = findExistingConfig(candidates);
  // PCSX2 writes its full ini on first run; before that there's nothing to merge into.
  if (!configPath) return false;
  return writeIfChanged(configPath, (content) => applySdlPadBindings(content, PCSX2_PAD));
};

// ---- RPCS3 (XInput handler, pad #1) --------------------------------------------------------------

const configureRpcs3 = (executablePath: string) => {
  const file = path.join(path.dirname(executablePath), "config", "input_configs", "global", "Default.yml");
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (!shouldWriteRpcs3Input(content)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, RPCS3_XINPUT_PLAYER1, "utf8");
  return true;
};

// ---- Dolphin (XInput/0/Gamepad) ------------------------------------------------------------------

const configureDolphin = (executablePath: string) => {
  const userDir = dolphinUserDirectoryCandidates(executablePath)[0];
  if (!userDir) return false;
  let changed = false;
  for (const [file, body] of [
    ["GCPadNew.ini", DOLPHIN_GCPAD],
    ["WiimoteNew.ini", DOLPHIN_WIIMOTE],
  ] as const) {
    const target = path.join(userDir, "Config", file);
    const content = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (!shouldWriteDolphinPad(content)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf8");
    changed = true;
  }
  return changed;
};

// ---- Azahar / Eden (Qt ini, SDL bindings pinned to the pad GUID) --------------------------------

/** Azahar/Eden data folder: a "user" folder next to the executable (portable) or %APPDATA%. */
export const qtEmulatorDataDir = (executablePath: string, appDataName: string) => {
  const portable = path.join(path.dirname(executablePath), "user");
  return fs.existsSync(portable)
    ? portable
    : path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), appDataName);
};

const qtEmulatorConfig = (executablePath: string, appDataName: string) =>
  path.join(qtEmulatorDataDir(executablePath, appDataName), "config", "qt-config.ini");

const configureAzahar = (executablePath: string, pad: XInputPad) => {
  const azahar = azaharBindings(pad.guid);
  const bindings = Object.fromEntries(
    Object.entries(azahar).map(([key, value]) => [`profiles\\1\\${key}`, value])
  );
  return writeIfChanged(qtEmulatorConfig(executablePath, "Azahar"), (content) => {
    const next = applyQtPadBindings(content, "Controls", "profiles\\1\\button_a", bindings);
    if (next === content) return content;
    // A fresh Azahar config has no profile array yet; declare the one profile we filled in.
    return /^profiles\\size=/m.test(next)
      ? next
      : setQtIniValue(setQtIniValue(next, "Controls", "profiles\\size", "1"), "Controls", "profile", "0");
  });
};

const configureEden = (executablePath: string, pad: XInputPad) =>
  writeIfChanged(qtEmulatorConfig(executablePath, "eden"), (content) =>
    applyQtPadBindings(content, "Controls", "player_0_button_a", edenBindings(pad.guid))
  );

// ---- Entry point ----------------------------------------------------------------------------------

/**
 * Makes sure the emulator for `system` reads an Xbox-layout controller. Safe to call before every
 * launch: it only writes when the emulator has no controller mapping yet. Never throws.
 */
export const configureControllerForEmulator = async (
  system: EmulatorSystem,
  executablePath: string | null
): Promise<boolean> => {
  if (process.platform !== "win32" || !executablePath) return false;
  try {
    switch (system) {
      case "ps1":
        return configureDuckStation();
      case "ps2":
        return configurePcsx2(executablePath);
      case "ps3":
        return configureRpcs3(executablePath);
      case "dolphin":
        return configureDolphin(executablePath);
      case "3ds": {
        const pad = await detectXInputPad();
        return pad ? configureAzahar(executablePath, pad) : false;
      }
      case "switch": {
        const pad = await detectXInputPad();
        return pad ? configureEden(executablePath, pad) : false;
      }
      // PPSSPP ships XInput defaults; RetroArch autoconfigures Xbox pads itself.
      default:
        return false;
    }
  } catch (error) {
    logger.warn(`[controller] could not configure ${system}`, error);
    return false;
  }
};
