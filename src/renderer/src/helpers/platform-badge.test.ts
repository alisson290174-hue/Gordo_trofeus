import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getPlatformBadge } from "./platform-badge";

const tag = (platform: string | null, shop = "launchbox") =>
  getPlatformBadge({ shop, platform }).label;

describe("getPlatformBadge", () => {
  it("names every console Opus emulates", () => {
    assert.equal(tag("PlayStation"), "PS1");
    assert.equal(tag("PlayStation 2"), "PS2");
    assert.equal(tag("PlayStation 3"), "PS3");
    assert.equal(tag("PlayStation Portable"), "PSP");
    assert.equal(tag("Nintendo Switch"), "SWITCH");
    assert.equal(tag("Nintendo 3DS"), "3DS");
    assert.equal(tag("Super Nintendo Entertainment System"), "SNES");
    assert.equal(tag("Nintendo Entertainment System"), "NES");
    assert.equal(tag("Nintendo 64"), "N64");
    assert.equal(tag("Nintendo Game Boy Advance"), "GBA");
    assert.equal(tag("Nintendo Game Boy Color"), "GBC");
    assert.equal(tag("Nintendo Game Boy"), "GB");
    assert.equal(tag("Nintendo GameCube"), "GC");
    assert.equal(tag("Nintendo Wii"), "WII");
  });

  it("tags store games as PC", () => {
    assert.equal(tag(null, "steam"), "PC");
    assert.equal(tag("PlayStation 2", "steam"), "PC");
    assert.equal(tag(null, "epic"), "PC");
  });
});
