import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fanartPlatformKey,
  findFanart,
  isSharpHeroSize,
  isWeakHero,
  LAUNCHBOX_IMAGES,
  normaliseFanartTitle,
  readImageSize,
  type FanartIndex,
} from "./classic-fanart-rules";

const index: FanartIndex = {
  ps1: {
    "resident evil 3 nemesis": ["re3.jpg", "re3-b.jpg"],
    "resident evil 2": ["re2.jpg"],
    "resident evil 2 dual shock": ["re2ds.jpg"],
  },
  switch: { "super mario party jamboree": ["jamboree.jpg"] },
  gba: {
    "pokemon emerald version": ["emerald.jpg"],
    "pokemon firered version": ["firered.jpg"],
  },
  pc: { "watch dogs": ["wd1.jpg", "wd2.jpg"] },
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
  assert.equal(fanartPlatformKey("pc"), "pc");
  assert.equal(fanartPlatformKey(null), null);
});

test("titles lose accents, tags and translation marks", () => {
  assert.equal(
    normaliseFanartTitle("Pokémon - Emerald (BR) [T1.0]"),
    "pokemon emerald"
  );
  assert.equal(normaliseFanartTitle("Super Mario 64 PT-BR"), "super mario 64");
  assert.equal(normaliseFanartTitle("The Legend of Zelda"), "legend of zelda");
  assert.equal(normaliseFanartTitle("Watch_Dogs™"), "watch dogs");
});

test("exact titles and unique prefixes find every background of the game", () => {
  assert.deepEqual(
    findFanart(index, "Nintendo Switch", "Super Mario Party Jamboree"),
    [`${LAUNCHBOX_IMAGES}jamboree.jpg`]
  );
  assert.deepEqual(findFanart(index, "PlayStation", "Resident Evil 3"), [
    `${LAUNCHBOX_IMAGES}re3.jpg`,
    `${LAUNCHBOX_IMAGES}re3-b.jpg`,
  ]);
  assert.deepEqual(findFanart(index, "pc", "Watch_Dogs"), [
    `${LAUNCHBOX_IMAGES}wd1.jpg`,
    `${LAUNCHBOX_IMAGES}wd2.jpg`,
  ]);
});

test("disc numbers and joined words still match", () => {
  assert.deepEqual(
    findFanart(index, "PlayStation", "Resident Evil 3 Nemesis CD 01")[0],
    `${LAUNCHBOX_IMAGES}re3.jpg`
  );
  assert.deepEqual(
    findFanart(index, "Nintendo Game Boy Advance", "Pokemon Fire Red"),
    [`${LAUNCHBOX_IMAGES}firered.jpg`]
  );
});

test("an edition suffix falls back to the base game", () => {
  assert.deepEqual(
    findFanart(index, "pc", "Watch_Dogs VR Edition")[0],
    `${LAUNCHBOX_IMAGES}wd1.jpg`
  );
  assert.deepEqual(
    findFanart(index, "pc", "Watch Dogs Remastered")[0],
    `${LAUNCHBOX_IMAGES}wd1.jpg`
  );
});

test("an ambiguous or unknown title gives nothing", () => {
  assert.deepEqual(findFanart(index, "PlayStation", "Resident Evil"), []);
  assert.deepEqual(findFanart(index, "PlayStation", "Dino Crisis"), []);
  assert.deepEqual(findFanart(index, "Atari 2600", "Pong"), []);
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
  // eShop banners: promo bands ("Demo Available") baked into the picture.
  assert.equal(
    isWeakHero("https://api.nlib.cc/nx/010019401051C000/banner"),
    true
  );
  assert.equal(
    isWeakHero("https://images.launchbox-app.com/b38bcf20-54e7.jpg"),
    false
  );
  // Banners are sharp, but may carry promo bands: LaunchBox fanart wins when there is one (a game
  // without fanart keeps its banner — isWeakHero only lets the backfill replace it).
});

test("a hero is sharp from 1280px wide and wider than 3:2", () => {
  assert.equal(isSharpHeroSize({ width: 1920, height: 1080 }), true);
  assert.equal(isSharpHeroSize({ width: 3840, height: 1240 }), true);
  assert.equal(isSharpHeroSize({ width: 1600, height: 1200 }), false);
  assert.equal(isSharpHeroSize({ width: 640, height: 360 }), false);
});

test("image sizes are read from the first bytes", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 1920);
  new DataView(png.buffer).setUint32(20, 1080);
  assert.deepEqual(readImageSize(png), { width: 1920, height: 1080 });

  // SOI, an APP0 segment of 4 bytes, then SOF0 with height 2160 / width 3840.
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
    0x08, 0x08, 0x70, 0x0f, 0x00, 0x03,
  ]);
  assert.deepEqual(readImageSize(jpeg), { width: 3840, height: 2160 });

  assert.equal(readImageSize(new Uint8Array([1, 2, 3, 4])), null);
});
