import type { EmulatorBinary, EmulatorSystem } from "@types";

export interface KnownBinary {
  system: EmulatorSystem;
  binary: EmulatorBinary;
  displayName: string;
  linuxNames: string[];
  windowsNames: string[];
  macosBundleNames: string[];
  flatpakIds: string[];
  versionFlags: string[];
  versionProbeDisabledPlatforms?: NodeJS.Platform[];
  romExtensions: string[];
  romDirectoryMarkers: string[];
}

export const KNOWN_BINARIES: Record<EmulatorSystem, KnownBinary> = {
  ps1: {
    system: "ps1",
    binary: "duckstation",
    displayName: "DuckStation",
    linuxNames: [
      "duckstation-qt",
      "duckstation-nogui",
      "duckstation",
      "DuckStation",
    ],
    windowsNames: [
      "duckstation-qt-x64-ReleaseLTCG.exe",
      "duckstation-qt.exe",
      "duckstation-nogui.exe",
    ],
    macosBundleNames: ["DuckStation.app"],
    flatpakIds: ["org.duckstation.DuckStation"],
    versionFlags: ["-version"],
    romExtensions: [
      ".cue",
      ".bin",
      ".iso",
      ".chd",
      ".pbp",
      ".img",
      ".sub",
      ".ccd",
      ".mds",
      ".mdf",
      ".ecm",
      ".m3u",
    ],
    romDirectoryMarkers: [],
  },
  ps2: {
    system: "ps2",
    binary: "pcsx2",
    displayName: "PCSX2",
    linuxNames: ["pcsx2-qt", "pcsx2", "PCSX2"],
    windowsNames: ["pcsx2-qt.exe", "pcsx2-qtx64-avx2.exe", "pcsx2.exe"],
    macosBundleNames: ["PCSX2.app"],
    flatpakIds: ["net.pcsx2.PCSX2"],
    versionFlags: ["-version"],
    romExtensions: [
      ".iso",
      ".chd",
      ".cso",
      ".zso",
      ".gz",
      ".nrg",
      ".cue",
      ".bin",
      ".mds",
      ".mdf",
      ".m3u",
    ],
    romDirectoryMarkers: [],
  },
  ps3: {
    system: "ps3",
    binary: "rpcs3",
    displayName: "RPCS3",
    linuxNames: ["rpcs3", "RPCS3"],
    windowsNames: ["rpcs3.exe"],
    macosBundleNames: ["RPCS3.app"],
    flatpakIds: ["net.rpcs3.RPCS3"],
    versionFlags: ["--version"],
    // Only formats RPCS3 launches as a game. Disc dumps are caught via
    // romDirectoryMarkers; license/internal files (.rap/.sfb/.bin/...) excluded.
    romExtensions: [".iso", ".pkg"],
    romDirectoryMarkers: ["PS3_GAME", "ps3_game"],
  },
  ps4: {
    system: "ps4",
    binary: "shadps4",
    displayName: "shadPS4",
    linuxNames: ["shadps4", "Shadps4-sdl.AppImage"],
    windowsNames: ["shadPS4.exe"],
    macosBundleNames: ["shadps4.app"],
    flatpakIds: ["net.shadps4.shadPS4"],
    versionFlags: [],
    versionProbeDisabledPlatforms: ["win32", "linux", "darwin"],
    // A PS4 game is an extracted folder (eboot.bin + sce_sys/param.sfo); PKGs must be extracted first.
    romExtensions: [],
    romDirectoryMarkers: ["sce_sys"],
  },
  psp: {
    system: "psp",
    binary: "ppsspp",
    displayName: "PPSSPP",
    linuxNames: ["PPSSPPSDL", "ppsspp"],
    windowsNames: ["PPSSPPWindows64.exe", "PPSSPPWindowsARM64.exe"],
    macosBundleNames: ["PPSSPP.app", "PPSSPPSDL.app"],
    flatpakIds: ["org.ppsspp.PPSSPP"],
    versionFlags: ["--version"],
    versionProbeDisabledPlatforms: ["win32"],
    romExtensions: [".iso", ".cso", ".chd", ".pbp"],
    romDirectoryMarkers: ["PSP_GAME", "psp_game"],
  },
  dolphin: {
    system: "dolphin",
    binary: "dolphin",
    displayName: "Dolphin",
    // `dolphin` is KDE's file manager on Linux. Dolphin Emulator packages use
    // `dolphin-emu`; keeping the ambiguous name here detects the wrong app.
    linuxNames: ["dolphin-emu", "dolphin-emu-qt2"],
    windowsNames: ["Dolphin.exe"],
    macosBundleNames: ["Dolphin.app"],
    flatpakIds: ["org.DolphinEmu.dolphin-emu"],
    versionFlags: ["--version"],
    romExtensions: [
      ".iso",
      ".gcm",
      ".bin",
      ".rvz",
      ".wia",
      ".gcz",
      ".ciso",
      ".tgc",
      ".wbfs",
      ".wad",
    ],
    romDirectoryMarkers: [],
  },
  switch: {
    system: "switch",
    // Eden is a maintained yuzu fork; it keeps yuzu's command line (-f -g <file>), so other
    // forks with the same CLI (citron, sudachi, yuzu) are recognised too.
    binary: "eden",
    displayName: "Eden",
    linuxNames: ["eden", "eden-cli", "citron", "sudachi", "yuzu"],
    windowsNames: ["eden.exe", "citron.exe", "sudachi.exe", "yuzu.exe"],
    macosBundleNames: ["Eden.app"],
    flatpakIds: ["dev.eden_emu.eden"],
    // The Eden/yuzu GUI opens its main window even with --version, so the version isn't probed.
    versionFlags: [],
    romExtensions: [".nsp", ".xci", ".nsz", ".xcz"],
    romDirectoryMarkers: [],
  },
  "3ds": {
    system: "3ds",
    // Azahar is the maintained Citra successor (same CLI); Citra/Lime3DS builds are recognised too.
    binary: "azahar",
    displayName: "Azahar",
    linuxNames: ["azahar", "citra-qt", "lime3ds-gui"],
    windowsNames: ["azahar.exe", "citra-qt.exe", "lime3ds-gui.exe", "lime3ds.exe"],
    macosBundleNames: ["Azahar.app"],
    flatpakIds: ["org.azahar_emu.Azahar"],
    // The Qt GUI opens its window even for --version, so the version isn't probed.
    versionFlags: [],
    // .cia install into the emulated SD card on first launch; the z* variants are Azahar's
    // compressed dumps.
    romExtensions: [".3ds", ".cci", ".cxi", ".3dsx", ".app", ".cia", ".zcci", ".zcia", ".z3dsx", ".zcxi"],
    romDirectoryMarkers: [],
  },
};

const EMULATOR_BINARIES: readonly EmulatorBinary[] = Array.from(
  new Set(Object.values(KNOWN_BINARIES).map((entry) => entry.binary))
);

export const systemsForBinary = (binary: EmulatorBinary): EmulatorSystem[] =>
  Object.values(KNOWN_BINARIES)
    .filter((entry) => entry.binary === binary)
    .map((entry) => entry.system);

export const isKnownEmulatorBinary = (
  value: unknown
): value is EmulatorBinary =>
  typeof value === "string" &&
  (EMULATOR_BINARIES as readonly string[]).includes(value);
