import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filterGamesBySearch } from "./library-search";

const games = [
  "Mario Kart 8 Deluxe",
  "Super Mario Galaxy",
  "Mercenaries: Playground of Destruction",
  "Rayman 3: Hoodlum Havoc",
  "Pokémon Legends: Arceus",
  "The Witcher 3: Wild Hunt",
].map((title) => ({ title }));
const titles = (q: string) => filterGamesBySearch(games, q).map((g) => g.title);

describe("filterGamesBySearch", () => {
  it("prefers titles containing the words", () => {
    assert.deepEqual(titles("mario"), ["Mario Kart 8 Deluxe", "Super Mario Galaxy"]);
    assert.deepEqual(titles("super galaxy"), ["Super Mario Galaxy"]);
  });

  it("ignores accents and case", () => {
    assert.deepEqual(titles("POKEMON"), ["Pokémon Legends: Arceus"]);
  });

  it("falls back to the loose match for typos", () => {
    assert.deepEqual(titles("wtcher"), ["The Witcher 3: Wild Hunt"]);
  });

  it("returns everything for an empty query", () => {
    assert.equal(filterGamesBySearch(games, "   ").length, games.length);
  });
});
