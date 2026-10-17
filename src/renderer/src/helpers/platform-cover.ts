import { getPlatformBadge, type PlatformTone } from "./platform-badge";

/**
 * The shape of each console's game case (width ÷ height), measured on the art backup's box scans
 * (16/10/2026: Switch 25 of 26 and PS2 175 of 176 within 5% of these). Showing one platform at a
 * time with its own case shape lets every cover appear whole, with no crop and no blurred bars.
 */
export const PLATFORM_COVER_RATIO: Record<PlatformTone, number> = {
  pc: 2 / 3, // Steam library capsule 600x900
  xbox: 2 / 3,
  port: 2 / 3,
  ps1: 1,
  ps2: 0.707,
  ps3: 0.86,
  ps4: 0.8,
  psp: 0.58,
  switch: 0.615,
  n3ds: 1.125,
  nds: 1.11,
  snes: 1.37,
  nes: 0.72,
  n64: 1.42,
  gb: 1,
  gbc: 1,
  gba: 1,
  gamecube: 0.715,
  wii: 0.715,
};

export const getCoverRatio = (game: {
  shop?: string | null;
  platform?: string | null;
}) => PLATFORM_COVER_RATIO[getPlatformBadge(game).tone] ?? 2 / 3;

/** A cover this close to the frame's shape fills it (≤ 6% trimmed, invisible); else it fits inside. */
export const COVER_RATIO_TOLERANCE = 0.06;
