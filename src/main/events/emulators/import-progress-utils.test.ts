import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cleanRomTitle } from "./import-progress-utils";

describe("cleanRomTitle", () => {
  it("drops region, translation, disc and site tags", () => {
    assert.equal(cleanRomTitle("Dino Crisis 2 (BR) (T1.0) (LEG) (www.romsportugues.com).cue"), "Dino Crisis 2");
    assert.equal(cleanRomTitle("Parasite Eve CD 01 [NTSC-BR] (www.romsportugues.tk).ccd"), "Parasite Eve");
    assert.equal(cleanRomTitle("Harvest Moon - Back to Nature (BR) (0.9.1) (www.romsportugues.com).bin"), "Harvest Moon - Back to Nature");
  });

  it("handles doubled extensions", () => {
    assert.equal(cleanRomTitle("Parasite Eve II (V6) (BR) (CD1) (www.romsportugues.com).cue.cue"), "Parasite Eve II");
  });

  it("keeps plain titles and never returns empty", () => {
    assert.equal(cleanRomTitle("Anime Hero V - Black Edition (GH3).iso"), "Anime Hero V - Black Edition");
    assert.equal(cleanRomTitle("(BR).iso"), "(BR)");
  });
});
