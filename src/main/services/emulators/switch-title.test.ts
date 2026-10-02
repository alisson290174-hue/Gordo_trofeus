import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  contentKindFromName,
  contentKindOfTitleId,
  extractSwitchTitleId,
  titleIdFromName,
} from "./switch-title";

/** Minimal PFS0 (NSP) whose file table holds a ticket named after the rights ID. */
function buildNsp(fileNames: string[]) {
  const strings = Buffer.from(fileNames.map((n) => `${n}\0`).join(""), "latin1");
  const header = Buffer.alloc(16);
  header.write("PFS0", 0, "latin1");
  header.writeUInt32LE(fileNames.length, 4);
  header.writeUInt32LE(strings.length, 8);
  const entries = Buffer.alloc(fileNames.length * 24);
  let offset = 0;
  fileNames.forEach((name, i) => {
    entries.writeUInt32LE(offset, i * 24 + 16);
    offset += Buffer.byteLength(name, "latin1") + 1;
  });
  return Buffer.concat([header, entries, strings, Buffer.alloc(64)]);
}

describe("switch-title", () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nsp-"));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reads Title IDs from dump names", () => {
    assert.equal(titleIdFromName("Pokemon Violet [01008F6008C5E000][v0].nsp"), "01008F6008C5E000");
    assert.equal(titleIdFromName("Mario Kart 8 Deluxe (0100152000022000)(v0).nsp"), "0100152000022000");
    assert.equal(titleIdFromName("Kirby Star Allies [01007e3006dda000][v0].nsp"), "01007E3006DDA000");
    assert.equal(titleIdFromName("Super Mario Galaxy.nsp"), null);
  });

  it("tells base games from updates and DLC", () => {
    assert.equal(contentKindOfTitleId("01008F6008C5E000"), "base");
    assert.equal(contentKindOfTitleId("01008F6008C5E800"), "update");
    assert.equal(contentKindOfTitleId("01008F6008C5F001"), "dlc");
    assert.equal(contentKindFromName("Super Mario 3D World Bowsers Fury [Update v1.1.0].nsp"), "update");
    assert.equal(contentKindFromName("Luigis Mansion 3 Multiplayer Pack 2 DLC.nsp"), "dlc");
    assert.equal(contentKindFromName("Pokemon Legends Arceus[v0].xci"), "base");
  });

  it("falls back to the NSP ticket when the name has no Title ID", async () => {
    const nsp = path.join(dir, "Super Smash Bros. Ultimate.nsp");
    fs.writeFileSync(
      nsp,
      buildNsp(["0a1b2c.nca", "01006a800016e0000000000000000009.tik", "01006a800016e0000000000000000009.cert"])
    );
    assert.equal(await extractSwitchTitleId(nsp), "01006A800016E000");

    const noTicket = path.join(dir, "Kirby Fighters 2.nsp");
    fs.writeFileSync(noTicket, buildNsp(["0a1b2c.nca", "0a1b2c.cnmt.xml"]));
    assert.equal(await extractSwitchTitleId(noTicket), null);
  });
});
