import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cleanRomTitle } from "./game-title";

describe("cleanRomTitle", () => {
  it("moves a trailing article back to the front", () => {
    assert.equal(
      cleanRomTitle("Legend of Zelda, The - Ocarina of Time (USA)"),
      "The Legend of Zelda: Ocarina of Time"
    );
    assert.equal(
      cleanRomTitle("Magical Quest Starring Mickey Mouse, The"),
      "The Magical Quest Starring Mickey Mouse"
    );
  });

  it("keeps commas that are part of the name", () => {
    assert.equal(cleanRomTitle("Yes, Your Grace"), "Yes, Your Grace");
    assert.equal(
      cleanRomTitle("Marvel Ultimate Alliance 2 (U) [SLUS-21879]"),
      "Marvel Ultimate Alliance 2"
    );
  });
});
