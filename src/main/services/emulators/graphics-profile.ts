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

/** Switch games released with official Brazilian Portuguese: Super Mario Galaxy, Galaxy 2, Jamboree. */
const OFFICIAL_PTBR_SWITCH = ["010099C022B96000", "0100FD8022DAA000", "0100965017338000", "010015100B514000", "01006B601380E000"];

/** Internal resolution multiplier per console and tier (low keeps native). */
const SCALE: Record<GpuTier, Partial<Record<EmulatorSystem, number>>> = {
  high: { ps1: 5, ps2: 3, dolphin: 3, "3ds": 4, switch: 2, ps3: 2 },
  mid: { ps1: 3, ps2: 2, dolphin: 2, "3ds": 2, ps3: 1.5 },
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
    const scale = SCALE[await detectGpuTier()][system];
    if (system === "switch") {
      const file = path.join(qtEmulatorDataDir(executablePath, "eden"), "config", "qt-config.ini");
      let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      // Fan translations replace the ENGLISH text, and games without Portuguese fall back to Latin
      // American Spanish when the console is set to PT-BR. So the console stays in English (1)
      // and only the games with official PT-BR get a per-game Brazilian Portuguese (17).
      const language = /^language_index=(\d+)/m.exec(content)?.[1];
      if (app.getLocale().toLowerCase().startsWith("pt")) {
        if (language === "17") content = setQtIniValue(content, "System", "language_index", "1");
        const customDir = path.join(path.dirname(file), "custom");
        fs.mkdirSync(customDir, { recursive: true });
        for (const titleId of OFFICIAL_PTBR_SWITCH) {
          const perGame = path.join(customDir, `${titleId}.ini`);
          const current = fs.existsSync(perGame) ? fs.readFileSync(perGame, "utf8") : "";
          if (/^language_index=17$/m.test(current)) continue;
          let next = setQtIniValue(current, "System", "language_index\\use_global", "false");
          next = setQtIniValue(next, "System", "language_index", "17");
          fs.writeFileSync(perGame, next, "utf8");
        }
      }
      // 2x (resolution_setup 4) on a strong GPU, only over Eden's own 1x default (2).
      const resolution = /^resolution_setup=(\d+)/m.exec(content)?.[1];
      if (scale === 2 && (!resolution || resolution === "2")) {
        content = setQtIniValue(content, "Renderer", "resolution_setup", "4");
        content = setQtIniValue(content, "Renderer", "resolution_setup\\default", "false");
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
      return true;
    }
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
      case "ps3": {
        // RPCS3 keeps "Resolution Scale: 100" (percent) under Video in config/config.yml.
        const file = path.join(path.dirname(executablePath), "config", "config.yml");
        if (!fs.existsSync(file)) return false;
        const content = fs.readFileSync(file, "utf8");
        if (!/^(\s*)Resolution Scale: 100\s*$/m.test(content)) return false;
        fs.writeFileSync(
          file,
          content.replace(/^(\s*)Resolution Scale: 100\s*$/m, `$1Resolution Scale: ${Math.round(scale * 100)}`),
          "utf8"
        );
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
      next = setQtIniValue(next, "Renderer", "async_shader_compilation\\default", "false");
      fs.writeFileSync(file, next, "utf8");
      return true;
    }
    if (system === "switch") {
      // Eden: asynchronous shaders remove the hitch the first time an effect appears.
      const file = path.join(qtEmulatorDataDir(executablePath, "eden"), "config", "qt-config.ini");
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (/^use_asynchronous_shaders=true/m.test(content)) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let next = setQtIniValue(content, "Renderer", "use_asynchronous_shaders", "true");
      next = setQtIniValue(next, "Renderer", "use_asynchronous_shaders\\default", "false");
      fs.writeFileSync(file, next, "utf8");
      return true;
    }
  } catch (error) {
    logger.warn(`[graphics] could not enable smooth shaders for ${system}`, error);
  }
  return false;
};
