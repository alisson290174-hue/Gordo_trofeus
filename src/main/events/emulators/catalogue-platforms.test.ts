import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { entryMatchesSystemPlatform } from "./catalogue-platforms";

describe("catalogue-platforms", () => {
  it("accepts Balói's server names and LaunchBox names", () => {
    assert.equal(entryMatchesSystemPlatform({ platform: "PlayStation 2" }, "ps2"), true);
    assert.equal(entryMatchesSystemPlatform({ platform: "Sony Playstation 2" }, "ps2"), true);
    assert.equal(entryMatchesSystemPlatform({ data: { platform: "playstation  2" } }, "ps2"), true);
  });

  it("still rejects a disc from another console", () => {
    assert.equal(entryMatchesSystemPlatform({ platform: "PlayStation" }, "ps2"), false);
    assert.equal(entryMatchesSystemPlatform({ platform: "Nintendo Wii" }, "ps2"), false);
  });

  it("accepts entries without a platform", () => {
    assert.equal(entryMatchesSystemPlatform({}, "ps2"), true);
  });
});
