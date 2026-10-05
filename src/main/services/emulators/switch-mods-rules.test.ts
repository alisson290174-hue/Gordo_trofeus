import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSafeModFile,
  matchModPack,
  matchModPackByTitle,
  pickSwitchModFolders,
  titleIdOfPack,
  withoutBrokenMods,
} from "./switch-mods-rules";

test("keeps one 60 FPS variant plus detail/resolution fixes, drops look-changing mods", () => {
  const picked = pickSwitchModFolders([
    "[1920x1080 v1.1.0]",
    "[21.9 Ultrawide v1.1.0]",
    "[60 FPS Static v1.1.0]",
    "[60 FPS Dynamic v1.1.0]",
    "[Level of Detail v1.1.0]",
    "[Disable Dynamic Resolution v1.1.0]",
    "[Disable DOF-BLUR v1.1.0]",
    "[120FPS - 1.4.0]",
    "[60FPS Split Screen v3.0.5]",
  ]);
  assert.deepEqual(picked, [
    "[60 FPS Static v1.1.0]",
    "[Level of Detail v1.1.0]",
    "[Disable Dynamic Resolution v1.1.0]",
    "[60FPS Split Screen v3.0.5]",
  ]);
});

test("only patch and data files are copied", () => {
  assert.equal(isSafeModFile("[60 FPS]/exefs/1.0.0.pchtxt"), true);
  assert.equal(isSafeModFile("[x]/romfs/UI/a.blarc.zs"), true);
  assert.equal(isSafeModFile("NX.Optimizer.3.1.6.exe"), false);
  assert.equal(isSafeModFile("[x]/exefs/run.bat"), false);
  assert.equal(isSafeModFile("Mod Instructions.txt"), false);
});

test("finds the pack by title id, tolerating the last digits", () => {
  const files = [
    "Luigis Mansion 3 [0100DCA0064A6800][mods].zip",
    "Kirby Star Allies [01007e3006dda000][mods].zip",
  ];
  assert.equal(matchModPack(files, "01007E3006DDA000"), files[1]);
  assert.equal(matchModPack(files, "0100DCA0064A6000"), files[0]);
  assert.equal(matchModPack(files, "0100000000010000"), null);
});

test("other frame rates and duplicate detail mods stay out", () => {
  assert.deepEqual(
    pickSwitchModFolders([
      "[360FPS v2.1.0]",
      "[90FPS v13]",
      "[Level of Detail v13.0.4]",
    ]),
    ["[Level of Detail v13.0.4]"]
  );
  assert.deepEqual(
    pickSwitchModFolders([
      "[60FPS All Areas v4.0.0]",
      "[Improved Level of Detail v4.0.0]",
      "[Maximum Level of Detail v4.0.0]",
    ]),
    ["[60FPS All Areas v4.0.0]", "[Improved Level of Detail v4.0.0]"]
  );
});

test("finds a pack by game title when the file has no title id", () => {
  const files = [
    "Super Smash Bros Ultimate [01006A800016E000][mods].zip",
    "Pokemon Legends Arceus [01001F5010DFA000][mods].zip",
  ];
  assert.equal(
    matchModPackByTitle(files, "Super Smash Bros. Ultimate"),
    files[0]
  );
  assert.equal(matchModPackByTitle(files, "Pokémon Legends: Arceus"), files[1]);
  assert.equal(titleIdOfPack(files[1]), "01001F5010DFA000");
});

test("drops the 60 FPS patch for Pokémon Violet and Scarlet, keeps other games", () => {
  const folders = ["60 FPS [v4.0.0]", "Level of Detail"];
  assert.deepEqual(withoutBrokenMods("01008F6008C5E000", folders), [
    "Level of Detail",
  ]);
  assert.deepEqual(withoutBrokenMods("0100a3d008c5c000", folders), [
    "Level of Detail",
  ]);
  const shield = ["60 FPS [v1.3.2]"];
  assert.deepEqual(withoutBrokenMods("01008DB008C2C000", shield), shield);
});
