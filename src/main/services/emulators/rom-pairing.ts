import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * How disc-image files in one folder become games: a primary file (.cue, .ccd, .iso…) plus the
 * sidecars that belong to it (.bin tracks, .img/.sub). Kept free of Electron imports so it can be
 * unit-tested.
 */
export interface Candidate {
  fullPath: string;
  name: string;
  isMarkerDir: boolean;
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const basenameNoExt = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

export interface GameGroup {
  primary: Candidate;
  sidecars: Candidate[];
}

/** Track files a .cue sheet points at (`FILE "Game (Track 2).bin" BINARY`), lower-cased. */
const readCueTracks = (cuePath: string): Set<string> => {
  try {
    const sheet = readFileSync(cuePath, "latin1");
    if (sheet.length > 64 * 1024) return new Set();
    const tracks = new Set<string>();
    for (const match of sheet.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim)) {
      tracks.add(path.basename(match[1] ?? match[2]).toLowerCase());
    }
    return tracks;
  } catch {
    return new Set();
  }
};

export const buildSidecarMap = (
  group: Candidate[],
  pairRules: Record<string, string[]>
): { sidecarOf: Map<string, Candidate[]>; skipped: Set<string> } => {
  const sidecarOf = new Map<string, Candidate[]>();
  const skipped = new Set<string>();
  const names = new Set(group.map((f) => f.name.toLowerCase()));
  for (const f of group) {
    const sidecarExts = pairRules[extOf(f.name)];
    if (!sidecarExts) continue;
    const base = basenameNoExt(f.name);
    // Multi-track discs ("Game (Track 2).bin") and odd names ("Game.cue.cue") only line up
    // through the cue sheet itself, not by sharing the cue's base name.
    const cueTracks =
      extOf(f.name) === ".cue" ? readCueTracks(f.fullPath) : new Set<string>();
    // A cue whose track files aren't here can't be played; it claims nothing, so its .bin
    // stays a game on its own (applyPairedRules drops the cue itself).
    if (cueTracks.size > 0 && ![...cueTracks].some((track) => names.has(track)))
      continue;
    const matched: Candidate[] = [];
    for (const other of group) {
      if (other === f) continue;
      const sameBase = basenameNoExt(other.name) === base;
      const listedInCue = cueTracks.has(other.name.toLowerCase());
      if (
        (sameBase || listedInCue) &&
        sidecarExts.includes(extOf(other.name))
      ) {
        matched.push(other);
        skipped.add(other.fullPath);
      }
    }
    sidecarOf.set(f.fullPath, matched);
  }
  return { sidecarOf, skipped };
};

const collectSidecarExts = (
  pairRules: Record<string, string[]>
): Set<string> => {
  const exts = new Set<string>();
  for (const list of Object.values(pairRules)) {
    for (const ext of list) exts.add(ext);
  }
  return exts;
};

export const applyPairedRules = (
  group: Candidate[],
  primaryExts: Set<string>,
  pairRules: Record<string, string[]>
): GameGroup[] => {
  const m3u = group.filter((f) => extOf(f.name) === ".m3u");
  if (m3u.length > 0) return m3u.map((primary) => ({ primary, sidecars: [] }));

  const { sidecarOf, skipped } = buildSidecarMap(group, pairRules);
  const sidecarExts = collectSidecarExts(pairRules);

  const names = new Set(group.map((f) => f.name.toLowerCase()));
  const out: GameGroup[] = [];
  for (const f of group) {
    if (skipped.has(f.fullPath)) continue;
    const ext = extOf(f.name);
    // A cue sheet whose track files aren't here can't be played (no emulator opens it); the
    // .bin it was meant for still shows up on its own.
    if (ext === ".cue") {
      const tracks = readCueTracks(f.fullPath);
      if (tracks.size > 0 && ![...tracks].some((track) => names.has(track)))
        continue;
    }
    if (primaryExts.has(ext)) {
      out.push({ primary: f, sidecars: sidecarOf.get(f.fullPath) ?? [] });
    } else if (sidecarExts.has(ext)) {
      out.push({ primary: f, sidecars: [] });
    }
  }
  return out;
};
