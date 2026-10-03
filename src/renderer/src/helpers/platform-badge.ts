/**
 * Short platform tag shown on game covers ("PS2", "SWITCH", "PC"…), with the console's colour.
 * Classics carry their console in `platform`; everything else is a PC game.
 */
export type PlatformTone =
  | "ps1"
  | "ps2"
  | "ps3"
  | "psp"
  | "switch"
  | "n3ds"
  | "snes"
  | "nes"
  | "n64"
  | "gb"
  | "gbc"
  | "nds"
  | "gba"
  | "gamecube"
  | "wii"
  | "pc";

export interface PlatformBadge {
  label: string;
  tone: PlatformTone;
  /** Full name for the tooltip. */
  name: string;
}

const RULES: { test: RegExp; label: string; tone: PlatformTone; name: string }[] = [
  { test: /playstation\s*portable|\bpsp\b/i, label: "PSP", tone: "psp", name: "PlayStation Portable" },
  { test: /playstation\s*3|\bps3\b/i, label: "PS3", tone: "ps3", name: "PlayStation 3" },
  { test: /playstation\s*2|\bps2\b/i, label: "PS2", tone: "ps2", name: "PlayStation 2" },
  { test: /playstation|\bps1\b|\bpsx\b/i, label: "PS1", tone: "ps1", name: "PlayStation" },
  { test: /\bswitch\b/i, label: "SWITCH", tone: "switch", name: "Nintendo Switch" },
  { test: /\b3ds\b/i, label: "3DS", tone: "n3ds", name: "Nintendo 3DS" },
  { test: /super nintendo|\bsnes\b/i, label: "SNES", tone: "snes", name: "Super Nintendo" },
  { test: /nintendo 64|\bn64\b/i, label: "N64", tone: "n64", name: "Nintendo 64" },
  { test: /nintendo\s*ds\b|\bnds\b/i, label: "DS", tone: "nds", name: "Nintendo DS" },
  { test: /game\s*boy advance|\bgba\b/i, label: "GBA", tone: "gba", name: "Game Boy Advance" },
  { test: /game\s*boy color|\bgbc\b/i, label: "GBC", tone: "gbc", name: "Game Boy Color" },
  { test: /game\s*boy|\bgb\b/i, label: "GB", tone: "gb", name: "Game Boy" },
  { test: /game\s*cube/i, label: "GC", tone: "gamecube", name: "GameCube" },
  { test: /\bwii\b/i, label: "WII", tone: "wii", name: "Wii" },
  { test: /nintendo entertainment system|\bnes\b/i, label: "NES", tone: "nes", name: "Nintendo (NES)" },
];

export const getPlatformBadge = (game: {
  shop?: string | null;
  platform?: string | null;
}): PlatformBadge => {
  if (game.shop === "launchbox" && game.platform) {
    const rule = RULES.find((candidate) => candidate.test.test(game.platform as string));
    if (rule) return { label: rule.label, tone: rule.tone, name: rule.name };
  }
  return { label: "PC", tone: "pc", name: "PC" };
};
