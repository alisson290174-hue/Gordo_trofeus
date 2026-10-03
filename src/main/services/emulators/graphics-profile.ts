import { execFile } from "node:child_process";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";
import { logger } from "../logger";
import { getIniLine, setIniValue } from "./duckstation-souvenir-config-value";
import { setQtIniValue } from "./controller-autoconfig-rules";
import { qtEmulatorDataDir } from "./controller-autoconfig";
import { dolphinUserDirectoryCandidates } from "./emulator-log-paths";
import { duckstationConfigCandidates, findExistingConfig, pcsx2ConfigCandidates } from "./emulator-config";

/**
 * Picture quality from the PC's own GPU: a recent card renders the light emulators (PS1, PS2,
 * GameCube/Wii, 3DS) at HD instead of their native 240p/480p. Only a resolution still at its
 * default (1x) is raised, so anything the user tuned stays as they left it.
 */
export type GpuTier = "high" | "mid" | "low";

export const gpuTierFromName = (names: string[]): GpuTier => {
  const gpu = names.join(" ").toLowerCase();
  if (/rtx\s*(30|40|50)\d\d|rx\s*(6[6-9]|7[6-9]|9\d)\d\d|arc\s*b\d/.test(gpu)) return "high";
  if (/rtx\s*20\d\d|gtx\s*16\d\d|gtx\s*10[78]0|rx\s*(5[67]|6[45])\d\d|arc\s*a\d/.test(gpu)) return "mid";
  return "low";
};

let tierCache: GpuTier | null = null;

export const detectGpuTier = async (): Promise<GpuTier> => {
  if (tierCache) return tierCache;
  if (process.platform !== "win32") return "low";
  const output = await new Promise<string>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_VideoController).Name"],
      { windowsHide: true, timeout: 15_000 },
      (_error, stdout) => resolve(stdout ?? "")
    );
  });
  tierCache = gpuTierFromName(output.split(/\r?\n/).filter(Boolean));
  return tierCache;
};

/** Internal resolution multiplier per console and tier (low keeps native). */
const SCALE: Record<GpuTier, Partial<Record<EmulatorSystem, number>>> = {
  high: { ps1: 5, ps2: 3, dolphin: 3, "3ds": 4 },
  mid: { ps1: 3, ps2: 2, dolphin: 2, "3ds": 2 },
  low: {},
};

const isDefault = (line: string | null) => line === null || /=\s*1(\.0+)?\s*$/.test(line);

const editIni = (file: string | null, section: string, key: string, value: number) => {
  if (!file || !fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, "utf8");
  if (!isDefault(getIniLine(content, section, key))) return false;
  fs.writeFileSync(file, setIniValue(content, section, key, String(value)), "utf8");
  return true;
};

export const applyGraphicsProfile = async (
  system: EmulatorSystem,
  executablePath: string | null
): Promise<boolean> => {
  if (process.platform !== "win32" || !executablePath) return false;
  try {
    if (system === "switch") {
      // Official PT-BR releases (Mario Galaxy, Jamboree, Kirby…) only show it with the console set
      // to Brazilian Portuguese (17); default English (1) or European Portuguese (9) hide it.
      if (!app.getLocale().toLowerCase().startsWith("pt")) return false;
      const file = path.join(qtEmulatorDataDir(executablePath, "eden"), "config", "qt-config.ini");
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      const current = /^language_index=(\d+)/m.exec(content)?.[1];
      if (current && current !== "1" && current !== "9") return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, setQtIniValue(content, "System", "language_index", "17"), "utf8");
      return true;
    }
    const scale = SCALE[await detectGpuTier()][system];
    if (!scale) return false;
    switch (system) {
      case "ps1":
        return editIni(findExistingConfig(duckstationConfigCandidates()), "GPU", "ResolutionScale", scale);
      case "ps2": {
        const file = findExistingConfig(pcsx2ConfigCandidates(executablePath));
        if (!editIni(file, "EmuCore/GS", "upscale_multiplier", scale) || !file) return false;
        // Untouched config: also turn on PCSX2's bundled 16:9 and de-interlace game patches.
        let content = fs.readFileSync(file, "utf8");
        for (const key of ["EnableWideScreenPatches", "EnableNoInterlacingPatches"]) {
          content = setIniValue(content, "EmuCore", key, "true");
        }
        fs.writeFileSync(file, content, "utf8");
        return true;
      }
      case "dolphin": {
        const userDir = dolphinUserDirectoryCandidates(executablePath)[0];
        const file = path.join(userDir, "Config", "GFX.ini");
        if (!fs.existsSync(file)) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, `[Settings]\nInternalResolution = ${scale}\n`, "utf8");
          return true;
        }
        return editIni(file, "Settings", "InternalResolution", scale);
      }
      case "3ds": {
        const file = path.join(qtEmulatorDataDir(executablePath, "Azahar"), "config", "qt-config.ini");
        const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        const current = /^resolution_factor=(\d+)/m.exec(content)?.[1];
        if (current && current !== "1") return false;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, setQtIniValue(content, "Renderer", "resolution_factor", String(scale)), "utf8");
        return true;
      }
      default:
        return false;
    }
  } catch (error) {
    logger.warn(`[graphics] could not tune ${system}`, error);
    return false;
  }
};

/**
 * Stutter-free shader compilation, independent of the resolution profile (applied once, only over
 * the emulator's own default): Dolphin "Hybrid Ubershaders" (ShaderCompilationMode = 2) and
 * Azahar asynchronous shader compilation. On a modern GPU these remove the hitches when new
 * effects appear, at no visible cost.
 */
export const applySmoothShaders = (system: EmulatorSystem, executablePath: string | null): boolean => {
  if (process.platform !== "win32" || !executablePath) return false;
  try {
    if (system === "dolphin") {
      const userDir = dolphinUserDirectoryCandidates(executablePath)[0];
      if (!userDir) return false;
      const file = path.join(userDir, "Config", "GFX.ini");
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      const line = getIniLine(content, "Settings", "ShaderCompilationMode");
      if (line !== null && !/=\s*0\s*$/.test(line)) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, setIniValue(content, "Settings", "ShaderCompilationMode", "2"), "utf8");
      return true;
    }
    if (system === "3ds") {
      const file = path.join(qtEmulatorDataDir(executablePath, "Azahar"), "config", "qt-config.ini");
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (/^async_shader_compilation=true/m.test(content)) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let next = setQtIniValue(content, "Renderer", "async_shader_compilation", "true");
      next = setQtIniValue(next, "Renderer", "async_shader_compilation\default", "false");
      fs.writeFileSync(file, next, "utf8");
      return true;
    }
  } catch (error) {
    logger.warn(`[graphics] could not enable smooth shaders for ${system}`, error);
  }
  return false;
};
