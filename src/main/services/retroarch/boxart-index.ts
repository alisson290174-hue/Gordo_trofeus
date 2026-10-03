import axios from "axios";

import type { RetroArchPlatform } from "@types";
import { logger } from "../logger";
import { pickBoxart } from "./boxart-matcher";

/**
 * Box art for cartridge games from libretro-thumbnails (the set RetroArch itself uses). One
 * directory listing per system is fetched per session and matched by title, since translated
 * ROMs never match a catalogue by CRC. Only this fixed HTTPS host is contacted.
 */
const THUMBNAILS = "https://thumbnails.libretro.com";
const MAX_LISTING_BYTES = 8 * 1024 * 1024;

const SYSTEM_FOLDERS: Record<RetroArchPlatform, string> = {
  nes: "Nintendo - Nintendo Entertainment System",
  snes: "Nintendo - Super Nintendo Entertainment System",
  n64: "Nintendo - Nintendo 64",
  gb: "Nintendo - Game Boy",
  gbc: "Nintendo - Game Boy Color",
  nds: "Nintendo - Nintendo DS",
  gba: "Nintendo - Game Boy Advance",
};

export type LibretroImageKind = "Named_Boxarts" | "Named_Titles";

const listings = new Map<string, Promise<string[]>>();

const imageFolderUrl = (system: string, kind: LibretroImageKind) =>
  `${THUMBNAILS}/${encodeURIComponent(system)}/${kind}/`;

const fetchListing = async (system: string, kind: LibretroImageKind): Promise<string[]> => {
  const { data } = await axios.get<string>(imageFolderUrl(system, kind), {
    responseType: "text",
    timeout: 30_000,
    maxContentLength: MAX_LISTING_BYTES,
    headers: { "User-Agent": "BaloiLauncher" },
  });
  const names: string[] = [];
  for (const match of String(data).matchAll(/href="([^"/?#]+)\.png"/g)) {
    try {
      names.push(decodeURIComponent(match[1]));
    } catch {
      // skip malformed entries
    }
  }
  return names;
};

const getListing = (system: string, kind: LibretroImageKind) => {
  const key = `${system}/${kind}`;
  let listing = listings.get(key);
  if (!listing) {
    listing = fetchListing(system, kind).catch((error) => {
      logger.warn(`[boxart] could not list ${key}`, String(error));
      listings.delete(key); // retry on the next import
      return [];
    });
    listings.set(key, listing);
  }
  return listing;
};

/** An image from a libretro-thumbnails system folder ("Sony - PlayStation"), matched by title. */
export const findLibretroImage = async (
  system: string,
  kind: LibretroImageKind,
  title: string
): Promise<string | null> => {
  // A translated copy ("Super Mario 64 PT-BR") uses the original game's art.
  const original = title.replace(/\s*\bPT-?BR\b\s*/gi, " ").trim();
  const name = pickBoxart(original, await getListing(system, kind));
  return name ? `${imageFolderUrl(system, kind)}${encodeURIComponent(name)}.png` : null;
};

export const findLibretroBoxart = (system: string, title: string) =>
  findLibretroImage(system, "Named_Boxarts", title);

/** Title screen (4:3): the Início strip's square tile for systems whose boxes have labels/strips. */
export const findLibretroTitleScreen = (system: string, title: string) =>
  findLibretroImage(system, "Named_Titles", title);

export const retroArchSystemFolder = (platform: RetroArchPlatform) => SYSTEM_FOLDERS[platform];

/** URL of the best-matching box art for a cartridge title, or null when libretro has none. */
export const findRetroArchBoxart = (platform: RetroArchPlatform, title: string) =>
  findLibretroBoxart(SYSTEM_FOLDERS[platform], title);
