import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseTropconf, parseTropusr } from "./ps3-trophy-files";

/** TROPUSR.DAT with one type-6 table holding the given states. */
const tropusr = (entries: { id: number; state: number; ticks: bigint }[]) => {
  const header = Buffer.alloc(0x30);
  header.writeUInt32BE(0x818f54ad, 0);
  header.writeUInt32BE(1, 8);
  const table = Buffer.alloc(0x20);
  table.writeUInt32BE(6, 0);
  table.writeUInt32BE(0x60, 4);
  table.writeUInt32BE(entries.length, 12);
  table.writeBigUInt64BE(0x50n, 16);
  const body = Buffer.concat(
    entries.map(({ id, state, ticks }) => {
      const entry = Buffer.alloc(0x70);
      entry.writeUInt32BE(6, 0);
      entry.writeUInt32BE(0x60, 4);
      entry.writeUInt32BE(id, 0x10);
      entry.writeUInt32BE(state, 0x14);
      entry.writeBigUInt64BE(ticks, 0x20);
      return entry;
    })
  );
  return Buffer.concat([header, table, body]);
};

describe("PS3 trophy files", () => {
  it("reads the trophy list with grades", () => {
    const xml = `<trophyconf><title-name>Wolverine Trophies</title-name>
      <trophy id="000" hidden="yes" ttype="P" pid="-1"><name>Platinum</name><detail>All &amp; more</detail></trophy>
      <trophy id="001" hidden="no" ttype="B" pid="000"><name>Bar Fight</name><detail>Defeated Victor</detail></trophy>
    </trophyconf>`;
    const { title, trophies } = parseTropconf(xml);
    assert.equal(title, "Wolverine Trophies");
    assert.deepEqual(
      trophies.map((t) => [t.id, t.grade, t.hidden]),
      [
        ["000", "P", true],
        ["001", "B", false],
      ]
    );
    assert.equal(trophies[0].description, "All & more");
  });

  it("reads unlocks and their time from TROPUSR.DAT", () => {
    // 2026-01-01T00:00:00Z in CellRtcTick (µs since year 1).
    const ticks = 62135596800000000n + 1767225600000000n;
    const unlocked = parseTropusr(
      tropusr([
        { id: 0, state: 0, ticks: 0n },
        { id: 3, state: 1, ticks },
      ])
    );
    assert.deepEqual([...unlocked.entries()], [[3, Date.UTC(2026, 0, 1)]]);
    assert.equal(parseTropusr(Buffer.alloc(64)).size, 0);
  });
});
