import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cleanRomTitle, isFileNameTitle } from "./import-progress-utils";

describe("cleanRomTitle", () => {
  it("drops region, translation, disc and site tags", () => {
    assert.equal(cleanRomTitle("Dino Crisis 2 (BR) (T1.0) (LEG) (www.romsportugues.com).cue"), "Dino Crisis 2");
    assert.equal(cleanRomTitle("Parasite Eve CD 01 [NTSC-BR] (www.romsportugues.tk).ccd"), "Parasite Eve");
    assert.equal(cleanRomTitle("Harvest Moon - Back to Nature (BR) (0.9.1) (www.romsportugues.com).bin"), "Harvest Moon - Back to Nature");
  });

  it("cleans Switch dump names", () => {
    assert.equal(cleanRomTitle("Animal Crossing New Horizons [01006F8002326000][v0][rpgonly.com].nsp"), "Animal Crossing New Horizons");
    assert.equal(cleanRomTitle("Super+Mario+Party+Jamboree.xci"), "Super Mario Party Jamboree");
    assert.equal(cleanRomTitle("FINAL FANTASY TACTICS - The Ivalice Chronicles Switch NSP Base Game.nsp"), "FINAL FANTASY TACTICS - The Ivalice Chronicles");
    assert.equal(cleanRomTitle("The Legend of Zelda Tears of the Kingdom [0100F2C0115B6000]+[v1.2.1][US](nsw2u.com).xci"), "The Legend of Zelda Tears of the Kingdom");
    assert.equal(cleanRomTitle("Kirbys_Return_to_Dream_Land_Deluxe_(rpgonly.com).xci"), "Kirbys Return to Dream Land Deluxe");
  });

  it("handles doubled extensions", () => {
    assert.equal(cleanRomTitle("Parasite Eve II (V6) (BR) (CD1) (www.romsportugues.com).cue.cue"), "Parasite Eve II");
  });

  it("keeps plain titles and never returns empty", () => {
    assert.equal(cleanRomTitle("Anime Hero V - Black Edition (GH3).iso"), "Anime Hero V - Black Edition");
    assert.equal(cleanRomTitle("(BR).iso"), "(BR)");
  });
});

describe("isFileNameTitle", () => {
  const file = "Animal Crossing New Horizons [01006F8002326000][v0][rpgonly.com].nsp";
  it("recognises titles a scan derived from the file name", () => {
    assert.equal(isFileNameTitle("Animal Crossing New Horizons [01006F8002326000][v0][rpgonly.com]", file), true);
    assert.equal(isFileNameTitle("Animal Crossing New Horizons", file), true);
    assert.equal(isFileNameTitle("Animal Crossing New Horizons.nsp", file), true);
    assert.equal(isFileNameTitle(null, file), true);
  });
  it("keeps catalogue and user titles", () => {
    assert.equal(isFileNameTitle("Animal Crossing: New Horizons", file), false);
    assert.equal(isFileNameTitle("Meu Animal Crossing", file), false);
  });
});
