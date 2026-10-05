import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decideEmulatorUpdate, versionNumbers } from "./emulator-update-rules";

describe("emulator updates", () => {
  it("reads the version number out of tags and file versions", () => {
    assert.deepEqual(versionNumbers("v2.2.0"), [2, 2, 0]);
    assert.deepEqual(versionNumbers("0.0.43-20184-d5213de6"), [0, 0, 43]);
    assert.equal(versionNumbers("latest"), null);
  });

  it("updates when the tag Opus installed is no longer the latest", () => {
    assert.equal(
      decideEmulatorUpdate({
        installedTag: "v1.21",
        installedVersion: null,
        latestTag: "v1.22",
      }),
      "update"
    );
    assert.equal(
      decideEmulatorUpdate({
        installedTag: "v1.22",
        installedVersion: null,
        latestTag: "v1.22",
      }),
      "up_to_date"
    );
  });

  it("compares numbers for emulators Opus didn't install, and adopts when it can't tell", () => {
    assert.equal(
      decideEmulatorUpdate({
        installedTag: null,
        installedVersion: "0.0.42-1",
        latestTag: "v0.0.43",
      }),
      "update"
    );
    assert.equal(
      decideEmulatorUpdate({
        installedTag: null,
        installedVersion: "0.0.43-20184",
        latestTag: "v0.0.43",
      }),
      "adopt"
    );
    assert.equal(
      decideEmulatorUpdate({
        installedTag: null,
        installedVersion: "dev",
        latestTag: "latest",
      }),
      "adopt"
    );
  });
});
