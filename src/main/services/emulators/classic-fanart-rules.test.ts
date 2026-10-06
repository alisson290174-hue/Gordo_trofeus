import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fanartPlatformKey,
  findFanart,
  isWeakHero,
  LAUNCHBOX_IMAGES,
  normaliseFanartTitle,
  type FanartIndex,
} from "./classic-fanart-rules";

const index: FanartIndex = {
  ps1: {
    "resident evil 3 nemesis": "re3.jpg",
    "resident evil 2": "re2.jpg",
    "resident evil 2 dual shock": "re2ds.jpg",
  },
  switch: { "super mario party jamboree": "jamboree.jpg" },
  gba: {
    "pokemon emerald version": "emerald.jpg",
    "pokemon firered version": "firered.jpg",
  },
};

test("Opus platform names map to the index consoles", () => {
  assert.equal(fanartPlatformKey("Nintendo Switch"), "switch");
  assert.equal(fanartPlatformKey("Nintendo 64"), "n64");
  assert.equal(fanartPlatformKey("Super Nintendo"), "snes");
  assert.equal(fanartPlatformKey("PlayStation 2"), "ps2");
  assert.equal(fanartPlatformKey("PlayStation"), "ps1");
  assert.equal(fanartPlatformKey("Nintendo 3DS"), "3ds");
  assert.equal(fanartPlatformKey("Nintendo DS"), "ds");
  assert.equal(fanartPlatformKey("Game Boy Advance"), "gba");
  assert.equal(fanartPlatformKey("PSP"), "psp");
  assert.equal(fanartPlatformKey(null), null);
});

test("titles lose accents, tags and translation marks", () => {
  assert.equal(
    normaliseFanartTitle("Pokémon - Emerald (BR) [T1.0]"),
    "pokemon emerald"
  );
  assert.equal(normaliseFanartTitle("Super Mario 64 PT-BR"), "super mario 64");
  assert.equal(normaliseFanartTitle("The Legend of Zelda"), "legend of zelda");
});

test("exact titles and unique prefixes find the art", () => {
  assert.equal(
    findFanart(index, "Nintendo Switch", "Super Mario Party Jamboree"),
    `${LAUNCHBOX_IMAGES}jamboree.jpg`
  );
  assert.equal(
    findFanart(index, "PlayStation", "Resident Evil 3"),
    `${LAUNCHBOX_IMAGES}re3.jpg`
  );
});

test("disc numbers and joined words still match", () => {
  assert.equal(
    findFanart(index, "PlayStation", "Resident Evil 3 Nemesis CD 01"),
    `${LAUNCHBOX_IMAGES}re3.jpg`
  );
  assert.equal(
    findFanart(index, "Nintendo Game Boy Advance", "Pokemon Fire Red"),
    `${LAUNCHBOX_IMAGES}firered.jpg`
  );
});

test("an ambiguous or unknown title gives nothing", () => {
  assert.equal(findFanart(index, "PlayStation", "Resident Evil"), null);
  assert.equal(findFanart(index, "PlayStation", "Dino Crisis"), null);
  assert.equal(findFanart(index, "Atari 2600", "Pong"), null);
});

test("small box scans, square covers and 500px Nintendo pictures are weak heroes", () => {
  assert.equal(isWeakHero(null), true);
  assert.equal(
    isWeakHero(
      "https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%2064/Named_Boxarts/x.png"
    ),
    true
  );
  assert.equal(
    isWeakHero(
      "https://www.nintendo.com/eu/media/images/10_share_images/games_15/x_image500w.jpg"
    ),
    true
  );
  assert.equal(isWeakHero("https://cover/x.jpg", "https://cover/x.jpg"), true);
  assert.equal(isWeakHero("https://api.nlib.cc/nx/0100/banner"), false);
  assert.equal(isWeakHero("https://images.launchbox-app.com/a.jpg"), false);
});
