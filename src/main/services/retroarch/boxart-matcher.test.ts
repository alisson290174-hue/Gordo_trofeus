import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickBoxart } from "./boxart-matcher";

const SNES = [
  "Battletoads-Double Dragon (Europe)",
  "Battletoads-Double Dragon (USA)",
  "Battletoads in Battlemaniacs (USA)",
  "Chrono Trigger (USA)",
  "Chrono Trigger (Japan)",
  "Donkey Kong Country 2 - Diddy's Kong Quest (USA)",
  "Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA)",
  "Donkey Kong Country 3 - Dixie Kong's Double Trouble! (Europe)",
  "Live A Live (Japan)",
  "Magical Quest Starring Mickey Mouse, The (USA)",
  "Super Metroid (USA, Europe) (En,Ja) (Virtual Console, Classic Mini, Switch Online)",
  "Super Metroid (Japan, USA)",
  "Super Metroid (USA) (Beta)",
  "Super Mario World (USA)",
];
const GBA = [
  "Kirby & The Amazing Mirror (USA)",
  "Pokemon - Emerald Version (USA, Europe)",
  "Pokemon - FireRed Version (USA)",
  "Pokemon - FireRed Version (USA) (Rev 1)",
  "Pokemon - LeafGreen Version (USA)",
];

describe("pickBoxart", () => {
  it("matches file-name titles to No-Intro names", () => {
    assert.equal(pickBoxart("Battletoads & Double Dragon", SNES), "Battletoads-Double Dragon (USA)");
    assert.equal(pickBoxart("Chrono Trigger", SNES), "Chrono Trigger (USA)");
    assert.equal(pickBoxart("Live-a-Live", SNES), "Live A Live (Japan)");
    assert.equal(pickBoxart("Magical Quest Starring Mickey Mouse, The", SNES), "Magical Quest Starring Mickey Mouse, The (USA)");
    assert.equal(pickBoxart("Super Metroid", SNES), "Super Metroid (Japan, USA)");
    assert.equal(pickBoxart("Kirby And The Amazing Mirror", GBA), "Kirby & The Amazing Mirror (USA)");
    assert.equal(pickBoxart("Pokemon Fire Red", GBA), "Pokemon - FireRed Version (USA)");
    assert.equal(pickBoxart("Pokemon - Emerald", GBA), "Pokemon - Emerald Version (USA, Europe)");
    assert.equal(pickBoxart("Pokemon Leaf Green", GBA), "Pokemon - LeafGreen Version (USA)");
  });

  it("accepts a subtitle but not another game in the series", () => {
    assert.equal(pickBoxart("Donkey Kong Country 3", SNES), "Donkey Kong Country 3 - Dixie Kong's Double Trouble! (USA)");
    assert.equal(pickBoxart("Donkey Kong Country", SNES), null);
  });

  it("returns nothing for a title the list doesn't have", () => {
    assert.equal(pickBoxart("Super Mundo Mario", SNES), null);
    assert.equal(pickBoxart("ab", SNES), null);
  });
});
