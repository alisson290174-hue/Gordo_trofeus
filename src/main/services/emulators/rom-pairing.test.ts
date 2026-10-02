import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyPairedRules, type Candidate } from "./rom-pairing";

const PS1_PRIMARY = new Set([".cue", ".ccd", ".mds", ".chd", ".pbp", ".iso", ".ecm"]);
const PS1_PAIRS = { ".cue": [".bin"], ".ccd": [".img", ".sub"], ".mds": [".mdf"] };

describe("rom-pairing (PS1 cue sheets)", () => {
  let dir: string;
  let group: Candidate[];

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps1pair-"));
    const files: Record<string, string> = {
      // Multi-track disc: both bins belong to the cue, neither is a game of its own.
      "Dino Crisis 2 (BR).cue":
        'FILE "Dino Crisis 2 (Track 1) (BR).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "Dino Crisis 2 (Track 2) (BR).bin" BINARY\n  TRACK 02 AUDIO\n',
      "Dino Crisis 2 (Track 1) (BR).bin": "x",
      "Dino Crisis 2 (Track 2) (BR).bin": "x",
      // Broken cue pointing at a file that isn't there; the real bin must stay the game.
      "Parasite Eve II (CD1).cue.cue": 'FILE "Parasite Eve II (USA) (Disc 1).bin" BINARY\n',
      "Parasite Eve II (CD1).bin": "x",
      // Broken cue with the same base name as its bin (FILE points elsewhere): the bin is the game.
      "Harvest Moon (BR).cue": 'FILE "Harvest Moon (USA).bin" BINARY\n',
      "Harvest Moon (BR).bin": "x",
      // A lone bin and a ccd set.
      "Vigilante 8.BIN": "x",
      "Parasite Eve CD 01.ccd": "x",
      "Parasite Eve CD 01.img": "x",
      "Parasite Eve CD 01.sub": "x",
    };
    group = Object.entries(files).map(([name, content]) => {
      fs.writeFileSync(path.join(dir, name), content);
      return { fullPath: path.join(dir, name), name, isMarkerDir: false };
    });
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("groups cue-listed tracks and ignores cues whose tracks are missing", () => {
    const games = applyPairedRules(group, PS1_PRIMARY, PS1_PAIRS);
    const byName = Object.fromEntries(games.map((g) => [g.primary.name, g.sidecars.map((s) => s.name).sort()]));
    assert.deepEqual(Object.keys(byName).sort(), [
      "Dino Crisis 2 (BR).cue",
      "Harvest Moon (BR).bin",
      "Parasite Eve CD 01.ccd",
      "Parasite Eve II (CD1).bin",
      "Vigilante 8.BIN",
    ]);
    assert.deepEqual(byName["Dino Crisis 2 (BR).cue"], [
      "Dino Crisis 2 (Track 1) (BR).bin",
      "Dino Crisis 2 (Track 2) (BR).bin",
    ]);
    assert.deepEqual(byName["Parasite Eve CD 01.ccd"], ["Parasite Eve CD 01.img", "Parasite Eve CD 01.sub"]);
  });
});
