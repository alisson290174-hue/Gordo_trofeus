import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cartridgeHashBytes, raConsoleForPlatform, toBigEndianN64 } from "./rom-hash";
import { parseBootExecutable } from "./ps2-disc-hash";

describe("RetroAchievements ROM hashing", () => {
  it("maps Balói platforms to RetroAchievements consoles", () => {
    assert.equal(raConsoleForPlatform("Super Nintendo Entertainment System"), "snes");
    assert.equal(raConsoleForPlatform("Nintendo Game Boy Advance"), "gba");
    assert.equal(raConsoleForPlatform("Nintendo 64"), "n64");
    assert.equal(raConsoleForPlatform("PlayStation"), "ps1");
    assert.equal(raConsoleForPlatform("PlayStation 2"), "ps2");
    assert.equal(raConsoleForPlatform("PlayStation 3"), null);
    assert.equal(raConsoleForPlatform("Nintendo Switch"), null);
  });

  it("drops the 512-byte copier header of SNES dumps and the iNES header", () => {
    const body = Buffer.alloc(8192 * 4, 7);
    const withHeader = Buffer.concat([Buffer.alloc(512, 1), body]);
    assert.deepEqual(cartridgeHashBytes("snes", withHeader), body);
    assert.deepEqual(cartridgeHashBytes("snes", body), body);
    const nes = Buffer.concat([Buffer.from("NES\x1a", "latin1"), Buffer.alloc(12), body]);
    assert.deepEqual(cartridgeHashBytes("nes", nes), body);
  });

  it("puts every N64 byte order back to big-endian", () => {
    const z64 = Buffer.from([0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4]);
    const v64 = Buffer.from([0x37, 0x80, 0x40, 0x12, 2, 1, 4, 3]);
    const n64 = Buffer.from([0x40, 0x12, 0x37, 0x80, 4, 3, 2, 1]);
    assert.deepEqual(toBigEndianN64(z64), z64);
    assert.deepEqual(toBigEndianN64(v64), z64);
    assert.deepEqual(toBigEndianN64(n64), z64);
  });

  it("reads the PS1 boot executable like rcheevos", () => {
    assert.equal(parseBootExecutable("BOOT = cdrom:\\SLUS_007.08;1\nTCB = 4", "BOOT"), "SLUS_007.08");
    assert.equal(parseBootExecutable("BOOT=cdrom:SCES_001.63;1", "BOOT"), "SCES_001.63");
    assert.equal(parseBootExecutable("BOOT2 = cdrom0:\\SLUS_212.68;1"), "SLUS_212.68");
  });
});
