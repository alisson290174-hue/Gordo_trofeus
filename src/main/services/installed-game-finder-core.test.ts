import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findEntryForGame,
  pickGameExecutable,
  titleMatchScore,
  type UninstallEntry,
} from "./installed-game-finder-core";

const entry = (
  name: string,
  location: string | null,
  icon: string | null = null
): UninstallEntry => ({
  key: `HKCU:\\Uninstall\\${name}`,
  name,
  location,
  icon,
});

describe("titleMatchScore", () => {
  it("ignores punctuation, accents and trademark signs", () => {
    assert.equal(titleMatchScore("Watch_Dogs™ 2", "Watch Dogs 2"), 1);
    assert.equal(titleMatchScore("Pokémon Ruby", "Pokemon Ruby"), 1);
  });

  it("does not count filler words", () => {
    assert.equal(
      titleMatchScore("The Witcher 3: Wild Hunt", "Witcher 3 Wild Hunt GOTY"),
      1
    );
  });

  it("scores unrelated programs low", () => {
    assert.ok(titleMatchScore("Chained Echoes", "Google Chrome") < 0.5);
  });
});

describe("findEntryForGame", () => {
  it("picks the matching installed program", () => {
    const entries = [
      entry("Google Chrome", "C:\\Chrome"),
      entry("Chained Echoes", "C:\\GOG Games\\Chained Echoes"),
    ];
    assert.equal(
      findEntryForGame("Chained Echoes", entries)?.name,
      "Chained Echoes"
    );
  });

  it("returns null instead of guessing when nothing matches well", () => {
    const entries = [
      entry("Chained Together", "C:\\x"),
      entry("Echo VR", "C:\\y"),
    ];
    assert.equal(findEntryForGame("Chained Echoes", entries), null);
  });
});

describe("pickGameExecutable", () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "baloi-finder-"));
    fs.writeFileSync(path.join(dir, "unins000.exe"), "x");
    fs.writeFileSync(path.join(dir, "UnityCrashHandler64.exe"), "x");
    fs.mkdirSync(path.join(dir, "redist"));
    fs.writeFileSync(
      path.join(dir, "redist", "vc_redist.x64.exe"),
      "x".repeat(5000)
    );
    fs.writeFileSync(path.join(dir, "Chained Echoes.exe"), "x".repeat(100));
    fs.writeFileSync(path.join(dir, "tool.exe"), "x".repeat(9000));
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("uses the executable the installer registered as icon", () => {
    const icon = `"${path.join(dir, "Chained Echoes.exe")}",0`;
    assert.equal(
      pickGameExecutable("Chained Echoes", entry("Chained Echoes", dir, icon)),
      path.join(dir, "Chained Echoes.exe")
    );
  });

  it("ignores an icon that points to the uninstaller", () => {
    const icon = path.join(dir, "unins000.exe");
    assert.equal(
      pickGameExecutable("Chained Echoes", entry("Chained Echoes", dir, icon)),
      path.join(dir, "Chained Echoes.exe")
    );
  });

  it("prefers the exe named like the game over bigger helper tools", () => {
    assert.equal(
      pickGameExecutable("Chained Echoes", entry("Chained Echoes", dir)),
      path.join(dir, "Chained Echoes.exe")
    );
  });

  it("recognises an executable named by the title's initials, not dev tools", () => {
    const cs = fs.mkdtempSync(path.join(os.tmpdir(), "baloi-cs2-"));
    const bin = path.join(cs, "game", "bin", "win64");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "vconsole2.exe"), "x".repeat(9000));
    fs.writeFileSync(path.join(bin, "cs2.exe"), "x");
    try {
      assert.equal(
        pickGameExecutable("Counter-Strike 2", entry("Counter-Strike 2", cs)),
        path.join(bin, "cs2.exe")
      );
    } finally {
      fs.rmSync(cs, { recursive: true, force: true });
    }
  });

  it("returns null when the folder doesn't exist", () => {
    assert.equal(
      pickGameExecutable(
        "Chained Echoes",
        entry("Chained Echoes", path.join(dir, "missing"))
      ),
      null
    );
  });
});
