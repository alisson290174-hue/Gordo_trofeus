import fs from "node:fs";
import path from "node:path";

import { setIniValue } from "./duckstation-souvenir-config-value";
import { duckstationConfigCandidates, findExistingConfig } from "./emulator-config";

/**
 * DuckStation keeps its own BIOS folder ([BIOS] SearchDirectory, "bios" inside its data dir) and
 * opens a first-run setup wizard instead of the game until that wizard is completed. When the user
 * already pointed Opus at a BIOS folder, hand that folder to DuckStation and mark the wizard done,
 * so "Jogar" boots the game. Pure transform, so it can be tested.
 */
export const applyDuckStationLaunchSettings = (content: string, biosPath: string): string => {
  let next = setIniValue(content, "BIOS", "SearchDirectory", biosPath);
  next = setIniValue(next, "Main", "SetupWizardIncomplete", "false");
  return next;
};

/** Writes the settings above into DuckStation's settings.ini (created if it doesn't exist yet). */
export const prepareDuckStationForLaunch = (biosPath: string | null) => {
  if (!biosPath || !fs.existsSync(biosPath)) return;
  const configPath =
    findExistingConfig(duckstationConfigCandidates()) ?? duckstationConfigCandidates()[0];
  const content = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const updated = applyDuckStationLaunchSettings(content, biosPath);
  if (updated === content) return;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, updated, "utf8");
};
