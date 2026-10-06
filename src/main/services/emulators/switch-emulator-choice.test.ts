import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  citronExecutableCandidates,
  preferredSwitchEmulator,
} from "./switch-emulator-choice";

test("Opus picks Citron for Pokémon Violet and Eden for everything else", () => {
  assert.equal(preferredSwitchEmulator(null, "01008F6008C5E000"), "citron");
  assert.equal(
    preferredSwitchEmulator(undefined, "01008f6008c5e000"),
    "citron"
  );
  assert.equal(preferredSwitchEmulator(null, "0100000000010000"), "eden");
  assert.equal(preferredSwitchEmulator(null, null), "eden");
});

test("the user's choice wins over the table", () => {
  assert.equal(preferredSwitchEmulator("eden", "01008F6008C5E000"), "eden");
  assert.equal(preferredSwitchEmulator("citron", "0100000000010000"), "citron");
});

test("Citron is looked for beside Eden's folder, then inside it", () => {
  const eden = path.join("D:", "Switch", "Eden", "eden.exe");
  assert.deepEqual(citronExecutableCandidates(eden), [
    path.join("D:", "Switch", "Citron", "citron.exe"),
    path.join("D:", "Switch", "Eden", "citron.exe"),
  ]);
});
