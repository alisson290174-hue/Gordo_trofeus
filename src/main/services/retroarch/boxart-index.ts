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
  gba: "Nintendo - Game Boy Advance",
};

const listings = new Map<string, Promise<string[]>>();

const boxartFolderUrl = (system: string) =>
  `${THUMBNAILS}/${encodeURIComponent(system)}/Named_Boxarts/`;

const fetchListing = async (system: string): Promise<string[]> => {
  const { data } = await axios.get<string>(boxartFolderUrl(system), {
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

const getListing = (system: string) => {
  let listing = listings.get(system);
  if (!listing) {
    listing = fetchListing(system).catch((error) => {
      logger.warn(`[boxart] could not list ${system} box art`, String(error));
      listings.delete(system); // retry on the next import
      return [];
    });
    listings.set(system, listing);
  }
  return listing;
};

/** Box art from a libretro-thumbnails system folder ("Sony - PlayStation"), matched by title. */
export const findLibretroBoxart = async (
  system: string,
  title: string
): Promise<string | null> => {
  const name = pickBoxart(title, await getListing(system));
  return name ? `${boxartFolderUrl(system)}${encodeURIComponent(name)}.png` : null;
};

/** URL of the best-matching box art for a cartridge title, or null when libretro has none. */
export const findRetroArchBoxart = (platform: RetroArchPlatform, title: string) =>
  findLibretroBoxart(SYSTEM_FOLDERS[platform], title);
