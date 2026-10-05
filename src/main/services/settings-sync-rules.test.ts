import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeFreshInstall,
  mergePreferences,
  stripSecrets,
  type SettingsSnapshot,
} from "./settings-sync-rules";

describe("settings sync", () => {
  it("never uploads keys or tokens", () => {
    const stripped = stripSecrets({
      language: "pt-BR",
      realDebridApiToken: "secret",
      ggDealsApiKey: "secret",
      retroAchievementsWebApiKey: "secret",
      bigPictureSoundsEnabled: true,
    });
    assert.deepEqual(stripped, {
      language: "pt-BR",
      bigPictureSoundsEnabled: true,
    });
  });

  it("restores preferences without overwriting local secrets", () => {
    const merged = mergePreferences(
      { torBoxApiToken: "local", language: "en" },
      { language: "pt-BR", torBoxApiToken: "remote" }
    );
    assert.deepEqual(merged, { torBoxApiToken: "local", language: "pt-BR" });
  });

  it("only treats an install with no linked folders as fresh", () => {
    const empty: SettingsSnapshot = {
      version: 1,
      preferences: {},
      emulatorsBaseDir: null,
      emulators: {
        ps2: { executablePath: null, biosPath: null, romFolders: [] },
      },
      retroarch: { executablePath: null, romFolders: [] },
    };
    assert.equal(looksLikeFreshInstall(empty), true);
    assert.equal(
      looksLikeFreshInstall({
        ...empty,
        emulators: {
          ps2: {
            executablePath: null,
            biosPath: null,
            romFolders: [{ path: "D:\\ps2", scanSubfolders: true }],
          },
        },
      }),
      false
    );
  });
});
