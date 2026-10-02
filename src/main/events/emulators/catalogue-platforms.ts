import type { EmulatorSystem } from "@types";

/** The bits of a catalogue entry the platform check reads. */
interface PlatformCarrier {
  platform?: string | null;
  data?: { platform?: string | null } | null;
}

// LaunchBox names ("Sony Playstation 2") and the short names Balói's own server sends
// ("PlayStation 2") — rejecting the latter made every rescan import nothing.
export const SYSTEM_CATALOGUE_PLATFORMS: Record<EmulatorSystem, string[]> = {
  ps1: ["Sony Playstation", "PlayStation"],
  ps2: ["Sony Playstation 2", "PlayStation 2"],
  ps3: ["Sony Playstation 3", "PlayStation 3"],
  psp: ["Sony PSP", "PlayStation Portable", "PSP"],
  dolphin: ["Nintendo GameCube", "Nintendo Wii", "GameCube", "Wii"],
};

const normalizePlatformName = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

export const entryMatchesSystemPlatform = (
  entry: PlatformCarrier,
  system: EmulatorSystem
): boolean => {
  const raw = entry.platform ?? entry.data?.platform ?? "";
  if (!raw) return true;
  const normalized = normalizePlatformName(raw);
  return SYSTEM_CATALOGUE_PLATFORMS[system].some(
    (platform) => normalizePlatformName(platform) === normalized
  );
};
