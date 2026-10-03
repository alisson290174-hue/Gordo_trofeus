import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  resolveLibraryIsDeleted,
  resolveMissingSteamImport,
  resolveLibrarySource,
} from "./resolve-library-source.ts";

describe("resolveLibrarySource", () => {
  it("never downgrades hydra to steam", () => {
    assert.equal(resolveLibrarySource("hydra", "steam"), "hydra");
    assert.equal(resolveLibrarySource("steam", "hydra"), "hydra");
    assert.equal(resolveLibrarySource("hydra", "hydra"), "hydra");
  });

  it("stamps steam when neither side is hydra", () => {
    assert.equal(resolveLibrarySource("steam", "steam"), "steam");
    assert.equal(resolveLibrarySource(undefined, "steam"), "steam");
    assert.equal(resolveLibrarySource("steam", undefined), "steam");
  });

  it("defaults to hydra when provenance is missing", () => {
    assert.equal(resolveLibrarySource(undefined, undefined), "hydra");
    assert.equal(resolveLibrarySource(null, null), "hydra");
  });
});

describe("resolveLibraryIsDeleted", () => {
  it("undeletes when the remote game is steam-sourced", () => {
    assert.equal(resolveLibraryIsDeleted(true, "steam"), false);
    assert.equal(resolveLibraryIsDeleted(false, "steam"), false);
  });

  it("undeletes when the game has an active Steam import", () => {
    assert.equal(resolveLibraryIsDeleted(true, "hydra", true), false);
    assert.equal(resolveLibraryIsDeleted(true, undefined, true), false);
  });

  it("keeps the local deleted flag without a Steam import", () => {
    assert.equal(resolveLibraryIsDeleted(true, "hydra"), true);
    assert.equal(resolveLibraryIsDeleted(false, "hydra"), false);
    assert.equal(resolveLibraryIsDeleted(true, undefined), true);
    assert.equal(resolveLibraryIsDeleted(true, null), true);
    assert.equal(resolveLibraryIsDeleted(false, undefined), false);
  });
});

describe("resolveMissingSteamImport", () => {
  // Opus: Steam imports come from our own owned-games sync, so a game missing from the server's
  // list is kept; the owned-games sync is what removes games that left the account.
  it("keeps an imported Steam game even when the server doesn't list it", () => {
    assert.equal(
      resolveMissingSteamImport(
        { shop: "steam", hasActiveSteamImport: true },
        false
      ),
      null
    );
  });

  it("keeps games still present remotely", () => {
    assert.equal(
      resolveMissingSteamImport(
        { shop: "steam", hasActiveSteamImport: true },
        true
      ),
      null
    );
  });

  it("does not hide unrelated local games", () => {
    assert.equal(
      resolveMissingSteamImport(
        { shop: "steam", hasActiveSteamImport: false },
        false
      ),
      null
    );
    assert.equal(
      resolveMissingSteamImport(
        { shop: "gog", hasActiveSteamImport: true },
        false
      ),
      null
    );
  });
});
