import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyDuckStationLaunchSettings } from "./duckstation-launch-config";

describe("applyDuckStationLaunchSettings", () => {
  const bios = String.raw`D:\EMULADORES\Emulador PS2\Bios`;

  it("points DuckStation at Opus's BIOS folder and skips the setup wizard", () => {
    const before =
      "[Main]\nUngrouped = true\n\n[BIOS]\nFastForwardBoot = false\nSearchDirectory = bios\n\n[Console]\nRegion = Auto\n";
    const after = applyDuckStationLaunchSettings(before, bios);
    assert.match(
      after,
      /\[BIOS\][^[]*SearchDirectory = D:\\EMULADORES\\Emulador PS2\\Bios/
    );
    assert.match(after, /\[Main\][^[]*SetupWizardIncomplete = false/);
    assert.match(after, /\[Console\]\nRegion = Auto/);
    assert.equal(after.match(/SearchDirectory/g)?.length, 1);
  });

  it("creates the sections in a fresh file and is idempotent", () => {
    const once = applyDuckStationLaunchSettings("", bios);
    assert.match(once, /\[BIOS\]\nSearchDirectory = /);
    assert.match(once, /\[Main\]\nSetupWizardIncomplete = false/);
    assert.equal(applyDuckStationLaunchSettings(once, bios), once);
  });
});
