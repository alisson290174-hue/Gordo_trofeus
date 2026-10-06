import fs from "node:fs";
import path from "node:path";

import type { SwitchEmulatorChoice } from "@types";

/**
 * Some Switch games run better in Citron than in Eden (both yuzu forks, same command line and the
 * same data layout, so Citron's portable "user" folder can point at Eden's keys/NAND/mods/saves).
 * A game the user didn't choose for follows this table, measured on the owner's PC.
 */
export const SWITCH_EMULATOR_DEFAULTS: Record<string, SwitchEmulatorChoice> = {
  // Pokémon Violet / Scarlet: steadier frame rate in Citron (min 28 vs 18 FPS at the same 2x).
  "01008F6008C5E000": "citron",
  "0100A3D008C5C000": "citron",
};

export const preferredSwitchEmulator = (
  choice: SwitchEmulatorChoice | null | undefined,
  titleId: string | null | undefined
): SwitchEmulatorChoice =>
  choice ?? SWITCH_EMULATOR_DEFAULTS[titleId?.toUpperCase() ?? ""] ?? "eden";

/** Citron next to Eden: "<Switch folder>/Citron/citron.exe" or in Eden's own folder. */
export const citronExecutableCandidates = (edenExecutable: string) => {
  const edenDir = path.dirname(edenExecutable);
  return [
    path.join(path.dirname(edenDir), "Citron", "citron.exe"),
    path.join(edenDir, "citron.exe"),
  ];
};

export const findCitronExecutable = (edenExecutable: string): string | null =>
  citronExecutableCandidates(edenExecutable).find((candidate) =>
    fs.existsSync(candidate)
  ) ?? null;

/** Executable to boot a Switch game with: Citron when chosen (or defaulted) and installed. */
export const resolveSwitchExecutable = (
  edenExecutable: string,
  choice: SwitchEmulatorChoice | null | undefined,
  titleId: string | null | undefined
): string => {
  if (preferredSwitchEmulator(choice, titleId) !== "citron")
    return edenExecutable;
  return findCitronExecutable(edenExecutable) ?? edenExecutable;
};
