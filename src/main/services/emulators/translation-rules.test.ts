import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findExecutables, findModRoots, matchGameByName, pickModRoot } from "./translation-rules";

const E4T_X = [
  "[3DS] Pokémon X (USA) (Tradução PT-BR, V1.5) (E4T)/LEIA-ME.txt",
  "[3DS] Pokémon X (USA) (Tradução PT-BR, V1.5) (E4T)/1 - Tradução/luma/titles/0004000000055D00/romfs/a/0/7/2",
  "[3DS] Pokémon X (USA) (Tradução PT-BR, V1.5) (E4T)/1 - Tradução/luma/titles/0004000000055D00/romfs/a/0/7/3",
];

describe("translation rules", () => {
  it("finds the Luma title folder of an E4T translation", () => {
    assert.deepEqual(findModRoots(E4T_X), [
      {
        root: "[3DS] Pokémon X (USA) (Tradução PT-BR, V1.5) (E4T)/1 - Tradução/luma/titles/0004000000055D00",
        titleId: "0004000000055D00",
      },
    ]);
  });

  it("picks the matching game from a bundle and refuses another game's translation", () => {
    const roots = findModRoots([
      "luma/titles/0004000000055D00/romfs/x.bin",
      "luma/titles/0004000000055E00/romfs/y.bin",
    ]);
    const pick = pickModRoot(roots, "0004000000055e00");
    assert.equal(pick.ok && pick.root.titleId, "0004000000055E00");
    assert.deepEqual(pickModRoot(roots, "000400000011C400"), { ok: false, reason: "wrong_game" });
  });

  it("uses a bare romfs for the game it was picked on", () => {
    const roots = findModRoots(["Tradução/romfs/message/us/text.bin", "Tradução/exefs/code.bin"]);
    assert.deepEqual(roots, [{ root: "Tradução", titleId: null }]);
    assert.deepEqual(pickModRoot(roots, "000400000011c500"), {
      ok: true,
      root: { root: "Tradução", titleId: null },
      titleId: "000400000011C500",
    });
    assert.deepEqual(pickModRoot(roots, null), { ok: false, reason: "unknown_title" });
    assert.deepEqual(pickModRoot([], "000400000011C500"), { ok: false, reason: "no_mod" });
  });

  it("reads Atmosphère layouts for Switch", () => {
    const roots = findModRoots(["atmosphere/contents/0100F2C0115B6000/romfs/Message/x.msbt"]);
    assert.equal(roots[0].titleId, "0100F2C0115B6000");
  });

  it("flags anything executable", () => {
    assert.deepEqual(findExecutables(["a/romfs/x.bin", "patcher.exe", "run.BAT", "readme.txt"]), [
      "patcher.exe",
      "run.BAT",
    ]);
  });

  it("reads sxos, Switch/Contents and bare title-ID folders", () => {
    assert.equal(findModRoots(["X TRPKG/sxos/titles/010049900F546000/romfs/a"])[0].titleId, "010049900F546000");
    assert.equal(findModRoots(["Pkg/Switch/Contents/01007ef00011e000/romfs/a"])[0].titleId, "01007EF00011E000");
    assert.equal(findModRoots(["01001F5010DFA000/romfs/a"])[0].titleId, "01001F5010DFA000");
  });

  it("matches an untagged archive to its game by name only when it's clear", () => {
    const games = [
      { title: "Kirby and the Forgotten Land" },
      { title: "Mario Kart 8 Deluxe" },
      { title: "Super Mario Party Jamboree" },
      { title: "Super Mario Odyssey" },
      { title: "Super Mario 3D World + Bowser's Fury" },
    ];
    assert.equal(matchGameByName("Kirby Forgotten Lands.zip", games)?.title, "Kirby and the Forgotten Land");
    assert.equal(matchGameByName("Mario kart 8 Deluxe.rar", games)?.title, "Mario Kart 8 Deluxe");
    assert.equal(matchGameByName("Super Mario Odyssey.rar", games)?.title, "Super Mario Odyssey");
    assert.equal(matchGameByName("Mario Tennis Aces.rar", games), null);
    assert.equal(matchGameByName("Pokemon Shield.rar", games), null);
  });
});
