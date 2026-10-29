import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickNeighbor, type Box } from "./spatial-navigation";

const box = (left: number, top: number, width = 100, height = 50): Box => ({
  left,
  top,
  width,
  height,
});

describe("spatial navigation", () => {
  // A row of three cards and a second row under the first one.
  const cards = [box(0, 0), box(120, 0), box(240, 0), box(0, 80), box(240, 80)];

  it("moves along a row", () => {
    assert.equal(pickNeighbor(cards[0], cards, "right"), 1);
    assert.equal(pickNeighbor(cards[1], cards, "left"), 0);
  });

  it("prefers the item straight below over a closer diagonal one", () => {
    assert.equal(pickNeighbor(cards[2], cards, "down"), 4);
    assert.equal(pickNeighbor(cards[0], cards, "down"), 3);
  });

  it("returns -1 at an edge", () => {
    assert.equal(pickNeighbor(cards[2], cards, "right"), -1);
    assert.equal(pickNeighbor(cards[0], cards, "up"), -1);
  });

  it("never leaves the row sideways (end of a row stays put)", () => {
    // Last card of a lower row; a shelf card sits further right but higher up the page.
    const layout = [box(0, 300), box(120, 300), box(400, 0, 150, 80)];
    assert.equal(pickNeighbor(layout[1], layout, "right"), -1);
    assert.equal(pickNeighbor(layout[0], layout, "right"), 1);
  });
});
