import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { Cracker } from "../../../shared/constants.js";
import { findAchievementFilesInLocations } from "./scan-game-directory-achievement-files.js";

describe("findAchievementFilesInLocations (Goldberg steam_settings)", () => {
  let tempDir: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-steam-settings-"));
  });

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds a flat achievements.json directly in steam_settings (single-game repacks)", async () => {
    const steamSettingsDir = path.join(tempDir, "flat", "steam_settings");
    fs.mkdirSync(steamSettingsDir, { recursive: true });
    fs.writeFileSync(path.join(steamSettingsDir, "achievements.json"), "[]");

    const files = await findAchievementFilesInLocations({
      bases: [],
      steamSettingsDirectories: [steamSettingsDir],
    });

    assert.deepEqual(files, [
      {
        type: Cracker.goldberg,
        filePath: path.join(steamSettingsDir, "achievements.json"),
      },
    ]);
  });

  it("still finds achievements.json nested under a per-appid folder (multi-game setups)", async () => {
    const steamSettingsDir = path.join(tempDir, "nested", "steam_settings");
    fs.mkdirSync(path.join(steamSettingsDir, "1637320"), { recursive: true });
    fs.writeFileSync(
      path.join(steamSettingsDir, "1637320", "achievements.json"),
      "[]"
    );

    const files = await findAchievementFilesInLocations({
      bases: [],
      steamSettingsDirectories: [steamSettingsDir],
    });

    assert.deepEqual(files, [
      {
        type: Cracker.goldberg,
        filePath: path.join(steamSettingsDir, "1637320", "achievements.json"),
      },
    ]);
  });

  it("finds both the flat and nested files when a setup has both", async () => {
    const steamSettingsDir = path.join(tempDir, "both", "steam_settings");
    fs.mkdirSync(path.join(steamSettingsDir, "10"), { recursive: true });
    fs.writeFileSync(path.join(steamSettingsDir, "achievements.json"), "[]");
    fs.writeFileSync(
      path.join(steamSettingsDir, "10", "achievements.json"),
      "[]"
    );

    const files = await findAchievementFilesInLocations({
      bases: [],
      steamSettingsDirectories: [steamSettingsDir],
    });

    assert.equal(files.length, 2);
  });

  it("returns nothing when steam_settings has no achievements.json at all", async () => {
    const steamSettingsDir = path.join(tempDir, "empty", "steam_settings");
    fs.mkdirSync(steamSettingsDir, { recursive: true });

    const files = await findAchievementFilesInLocations({
      bases: [],
      steamSettingsDirectories: [steamSettingsDir],
    });

    assert.deepEqual(files, []);
  });
});
