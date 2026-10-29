import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cleanFolderTitle,
  IGNORED_FOLDER,
  isConfidentTitleMatch,
  searchTermsFor,
} from "./folder-game-finder-core";

describe("cleanFolderTitle", () => {
  it("drops versions, dots and the release group", () => {
    assert.equal(cleanFolderTitle("Dome.Keeper.v5.0.8"), "Dome Keeper");
    assert.equal(
      cleanFolderTitle("CONTROL.Resonant-InsaneRamZes"),
      "CONTROL Resonant"
    );
  });

  it("splits glued words", () => {
    assert.equal(cleanFolderTitle("DeathStranding"), "Death Stranding");
  });

  it("keeps plain names and numbers that belong to the title", () => {
    assert.equal(
      cleanFolderTitle("Pro Evolution Soccer 2013"),
      "Pro Evolution Soccer 2013"
    );
    assert.equal(cleanFolderTitle("DOOM 64"), "DOOM 64");
    assert.equal(
      cleanFolderTitle("Call of Duty - Modern Warfare"),
      "Call of Duty - Modern Warfare"
    );
  });

  it("removes repack and bracket tags", () => {
    assert.equal(
      cleanFolderTitle("Hollow Knight [FitGirl Repack]"),
      "Hollow Knight"
    );
    assert.equal(cleanFolderTitle("Celeste (GOG)"), "Celeste");
  });
});

describe("isConfidentTitleMatch", () => {
  it("accepts the same game", () => {
    assert.ok(isConfidentTitleMatch("Dome Keeper", "Dome Keeper"));
    assert.ok(isConfidentTitleMatch("Death Stranding", "DEATH STRANDING"));
    assert.ok(
      isConfidentTitleMatch(
        "The Blood of Dawnwalker",
        "The Blood of Dawnwalker"
      )
    );
  });

  it("rejects a different game that only shares a word", () => {
    assert.ok(!isConfidentTitleMatch("hydra", "Hydra Slayer: Arena"));
    assert.ok(!isConfidentTitleMatch("Firewatch", "Fire Watch Tower Sim"));
  });
});

describe("IGNORED_FOLDER", () => {
  it("skips installers and tool folders", () => {
    assert.ok(IGNORED_FOLDER.test("FDM-instalador"));
    assert.ok(IGNORED_FOLDER.test("$RECYCLE.BIN"));
    assert.ok(IGNORED_FOLDER.test("Steam"));
    assert.ok(IGNORED_FOLDER.test("SteamLibrary"));
    assert.ok(!IGNORED_FOLDER.test("Steamworld Dig"));
    assert.ok(!IGNORED_FOLDER.test("Pro Evolution Soccer 2013"));
  });
});

describe("isConfidentTitleMatch — editions and cut names", () => {
  it("ignores edition words the folder does not carry", () => {
    assert.ok(
      isConfidentTitleMatch("Death Stranding", "DEATH STRANDING DIRECTOR'S CUT")
    );
    assert.ok(
      !isConfidentTitleMatch(
        "Death Stranding",
        "DEATH STRANDING 2: ON THE BEACH"
      )
    );
  });

  it("accepts a folder name cut in the middle of the last word", () => {
    assert.ok(
      isConfidentTitleMatch(
        "Turnip Boy Commits Tax Evad",
        "Turnip Boy Commits Tax Evasion"
      )
    );
  });
});

describe("searchTermsFor", () => {
  it("also tries without the last word", () => {
    assert.deepEqual(searchTermsFor("Turnip Boy Commits Tax Evad"), [
      "Turnip Boy Commits Tax Evad",
      "Turnip Boy Commits Tax",
    ]);
    assert.deepEqual(searchTermsFor("Firewatch"), ["Firewatch"]);
  });
});

describe("isConfidentTitleMatch — sequels", () => {
  it("never takes a numbered sequel for the original", () => {
    assert.ok(!isConfidentTitleMatch("The Outer Worlds", "The Outer Worlds 2"));
    assert.ok(!isConfidentTitleMatch("Hades", "Hades II"));
    assert.ok(isConfidentTitleMatch("Hades II", "Hades II"));
    assert.ok(isConfidentTitleMatch("DOOM 64", "DOOM 64"));
  });
});
