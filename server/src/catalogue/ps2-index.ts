import fs from "node:fs";
import { normalizeGenres } from "./genres.js";

/**
 * PS2 metadata the client's "launchbox" shop needs (title, art, description), keyed by disc serial.
 * Built offline from PCSX2's GameIndex (serial → official name), the LaunchBox Games DB (fanart,
 * clear logo, box art, overview) and xlenore/ps2-covers (clean box scans). ~12.8k serials.
 * Regenerate with the scratchpad build script; images are served by their original CDNs.
 */
interface Ps2Game {
  id: string;
  t: string;
  y: string;
  dev: string;
  pub: string;
  g: string[];
  o: string;
  hero: string | null;
  logo: string | null;
  cover: string | null;
  banner: string | null;
  shots: string[];
}

interface Ps2Index {
  games: Ps2Game[];
  /** serial → [game index (-1 = no LaunchBox match), GameIndex name, has xlenore cover (0/1)] */
  serials: Record<string, [number, string, number]>;
}

// dist/catalogue/ps2-index.js → ../../src/catalogue/ps2-index.json (tsc doesn't copy JSON).
const INDEX_PATH = new URL("../../src/catalogue/ps2-index.json", import.meta.url);

let index: Ps2Index | null = null;
let byLaunchboxId: Map<string, Ps2Game> | null = null;

function load(): Ps2Index {
  if (!index) {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as Ps2Index;
    byLaunchboxId = new Map(index.games.map((game) => [game.id, game]));
  }
  return index;
}

const LB_IMAGES = "https://images.launchbox-app.com/";
const lbImage = (file: string | null) => (file ? `${LB_IMAGES}${file}` : null);
const xlenoreCover = (serial: string) =>
  `https://cdn.jsdelivr.net/gh/xlenore/ps2-covers@main/covers/default/${serial}.jpg`;

/** "rom-sku-SCES50959" → "SCES-50959". */
export function serialFromObjectId(objectId: string): string | null {
  const match = objectId.match(/^rom-sku-([A-Z]{4})-?(\d{3})\.?(\d{2})$/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}${match[3]}` : null;
}

export interface Ps2Metadata {
  serial: string | null;
  title: string;
  releaseYear: number | null;
  developers: string[];
  publishers: string[];
  genres: string[];
  description: string;
  coverUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
  headerUrl: string | null;
  screenshots: string[];
}

/**
 * ROM hacks carry a made-up serial no database knows. Each one borrows the art and info of the
 * game it was built on, under its own name.
 */
const ROM_HACKS: Record<string, { base: string; title: string }> = {
  // "naruto6" — hack of Naruto Shippuden: Ultimate Ninja 5.
  "SLUS-55606": { base: "SLES-55605", title: "Naruto Shippuden: Ultimate Ninja 6" },
};

/** Metadata for a launchbox-shop objectId ("rom-sku-…" serial or a LaunchBox database id). */
export function getPs2Metadata(objectId: string): Ps2Metadata | null {
  const { games, serials } = load();
  const serial = serialFromObjectId(objectId);

  const hack = serial ? ROM_HACKS[serial] : undefined;
  if (hack) {
    const base = getPs2Metadata(`rom-sku-${hack.base.replace("-", "")}`);
    // No logo: the base game's logo spells the wrong name/number.
    return base ? { ...base, serial, title: hack.title, logoUrl: null } : null;
  }

  let game: Ps2Game | null = null;
  let indexName: string | null = null;
  let hasXlenore = false;

  if (serial) {
    const entry = serials[serial];
    if (!entry) return null;
    const [gameIndex, name, xlenore] = entry;
    game = gameIndex >= 0 ? games[gameIndex] : null;
    indexName = name;
    hasXlenore = xlenore === 1;
  } else if (/^\d+$/.test(objectId)) {
    game = byLaunchboxId?.get(objectId) ?? null;
    if (!game) return null;
  } else {
    return null;
  }

  const coverUrl = serial && hasXlenore ? xlenoreCover(serial) : lbImage(game?.cover ?? null);
  const heroUrl = lbImage(game?.hero ?? null);

  return {
    serial,
    title: game?.t || indexName || objectId,
    releaseYear: game?.y ? Number(game.y) || null : null,
    developers: game?.dev ? [game.dev] : [],
    publishers: game?.pub ? [game.pub] : [],
    genres: normalizeGenres(game?.g ?? []),
    description: game?.o ?? "",
    coverUrl,
    heroUrl,
    logoUrl: lbImage(game?.logo ?? null),
    headerUrl: lbImage(game?.banner ?? null) ?? heroUrl,
    screenshots: (game?.shots ?? []).map((file) => `${LB_IMAGES}${file}`),
  };
}
