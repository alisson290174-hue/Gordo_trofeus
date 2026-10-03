import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cueBaseName, repairCueText } from "./cue-repair-rules";

const CUE = 'FILE "Dino Crisis (PT-BR] [Dublado e Traduzido].bin" BINARY\n  TRACK 01 MODE2/2352\n';

describe("cue repair", () => {
  it("points a single-file cue at the .bin named like the cue", () => {
    const fixed = repairCueText(CUE, "Dino Crisis (DUBeLEG).cue", (name) => name === "Dino Crisis (DUBeLEG).bin");
    assert.equal(fixed, 'FILE "Dino Crisis (DUBeLEG).bin" BINARY\n  TRACK 01 MODE2/2352\n');
  });

  it("handles .cue.cue names and leaves good or multi-file cues alone", () => {
    assert.equal(cueBaseName("Parasite Eve II (CD1).cue.cue"), "Parasite Eve II (CD1)");
    assert.equal(repairCueText(CUE, "X.cue", () => true), null);
    assert.equal(repairCueText(CUE, "X.cue", () => false), null);
    const multi = 'FILE "a.bin" BINARY\nFILE "b.bin" BINARY\n';
    assert.equal(repairCueText(multi, "X.cue", (n) => n === "X.bin"), null);
  });
});
