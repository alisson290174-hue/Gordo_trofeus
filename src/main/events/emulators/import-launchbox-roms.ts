import axios from "axios";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { chunk } from "lodash-es";

import { registerEvent } from "../register-event";
import {
  setActiveClassicsImport,
  updateActiveClassicsImport,
} from "./classics-import-state";
import { isWithin } from "./rom-path-utils";
import { entryMatchesSystemPlatform } from "./catalogue-platforms";
import { contentKindOfTitleId } from "@main/services/emulators/switch-title";
import { autoSetupEmulator } from "@main/services/emulators/emulator-auto-setup";
import { repairCuesInFolder } from "@main/services/emulators/cue-repair";
import {
  findLibretroBoxart,
  findLibretroTitleScreen,
} from "@main/services/retroarch/boxart-index";
import {
  bandPercent,
  baseNameWithoutExt,
  cleanRomTitle,
  isFileNameTitle,
} from "./import-progress-utils";
import {
  HydraApi,
  WindowManager,
  emulators,
  logger,
  mergeImportedProfileGames,
} from "@main/services";
import { clearFinishedDownload, platformToSystem } from "@main/helpers";
import {
  fetchShopDetailsForSkus,
  normalizeSku,
  type LaunchboxShopDetailsEntry,
} from "@main/services/emulators";
import {
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import type {
  ClassicsDisc,
  EmulatorSystem,
  RomFolder,
  ShopAssets,
  ShopDetails,
} from "@types";

interface FolderInput {
  path: string;
  scanSubfolders: boolean;
}

const PROFILE_BATCH_CHUNK_SIZE = 100;

type CancelSignal = {
  cancelled: boolean;
  abortController?: AbortController;
};

const inflight = new Map<string, CancelSignal>();

const lookupYmlSku = (
  index: Map<string, string>,
  primaryPath: string
): string | null => {
  const norm = path.normalize(primaryPath).replace(/[\\/]+$/, "");
  return (
    index.get(norm) ??
    index.get(path.basename(norm)) ??
    index.get(path.basename(path.dirname(norm))) ??
    null
  );
};

const ymlValueForGame = (primaryPath: string): string =>
  path.basename(primaryPath).toUpperCase() === "PS3_GAME"
    ? path.dirname(primaryPath)
    : primaryPath;

const mapToShopDetails = (
  objectId: string,
  entry: LaunchboxShopDetailsEntry,
  language: string
): ShopDetails => {
  const data = entry.data;
  const description = data?.description ?? "";
  return {
    objectId,
    descriptionLanguage: language,
    name: data?.title ?? "",
    platform: entry.platform ?? data?.platform ?? undefined,
    skus: entry.skus ?? undefined,
    steam_appid: 0,
    detailed_description: description,
    about_the_game: description,
    short_description: "",
    developers: data?.developers ?? [],
    publishers: data?.publishers ?? [],
    genres: (data?.genres ?? []).map((name, index) => ({
      id: String(index),
      name,
    })),
    movies: undefined,
    supported_languages: "",
    screenshots: (data?.screenshots ?? []).map((url, index) => ({
      id: index,
      path_thumbnail: url,
      path_full: url,
    })),
    pc_requirements: { minimum: "", recommended: "" },
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: false,
      date: data?.releaseDate ?? "",
    },
    content_descriptors: { ids: [] },
  };
};

const DISC_LABEL_REGEX = /\b(?:disc|cd|disk)\s*(\d+)\b/i;

const parseDiscNumber = (fileName: string): number | null => {
  const match = DISC_LABEL_REGEX.exec(fileName);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
};

// Strips disc markers from a filename so multi-disc siblings collapse to the
// same key. Handles "(Disc 1)", "[CD 2]", "(Disc 1 of 3)", " - Disc 1",
// " Disc 1".
const stripDiscMarker = (fileName: string): string => {
  const base = fileName.replace(/\.[^.]+$/, "");
  return base
    .replace(/\s*[([][^()\]]*?(?:disc|cd|disk)\s*\d+[^()\]]*?[)\]]/gi, "")
    .replace(/\s*-\s*(?:disc|cd|disk)\s*\d+\b/gi, "")
    .replace(/\s+(?:disc|cd|disk)\s*\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

const buildDiscList = (
  files: { primaryPath: string; name: string; sku: string | null }[]
): ClassicsDisc[] => {
  const sorted = [...files].sort((a, b) => {
    const ad = parseDiscNumber(a.name);
    const bd = parseDiscNumber(b.name);
    if (ad !== null && bd !== null) return ad - bd;
    if (ad !== null) return -1;
    if (bd !== null) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return sorted.map((f, index) => {
    const detected = parseDiscNumber(f.name);
    const discNumber = detected ?? index + 1;
    const label =
      detected !== null || sorted.length > 1
        ? `Disc ${discNumber}`
        : baseNameWithoutExt(f.name);
    return {
      path: f.primaryPath,
      label,
      fileName: f.name,
      sku: f.sku,
    };
  });
};

const SYSTEM_DEFAULT_PLATFORM: Record<EmulatorSystem, string | null> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PlayStation Portable",
  dolphin: null,
  switch: "Nintendo Switch",
  "3ds": "Nintendo 3DS",
};

export const persistEntryLocally = async (
  entry: LaunchboxShopDetailsEntry,
  language: string,
  discs: ClassicsDisc[],
  defaultPlatform: string | null,
  romSizeBytes: number | null,
  /** Art for the Início strip; Switch icons are square already and need none. */
  tileUrl: string | null = null
) => {
  const shop = "launchbox" as const;
  const objectId = entry.objectId;
  const gameKey = levelKeys.game(shop, objectId);
  const cacheKey = levelKeys.gameShopCacheItem(shop, objectId, language);

  const shopDetails = mapToShopDetails(objectId, entry, language);
  await gamesShopCacheSublevel.put(cacheKey, shopDetails).catch((err) => {
    logger.error("Could not cache launchbox shop details", err);
  });

  const assetsSource = entry.data?.assets;
  const fallbackTitle = entry.data?.title ?? "";
  const assets: ShopAssets = {
    objectId,
    shop,
    title: assetsSource?.title ?? fallbackTitle,
    iconUrl: assetsSource?.iconUrl ?? null,
    libraryHeroImageUrl: assetsSource?.libraryHeroImageUrl ?? null,
    libraryImageUrl: assetsSource?.libraryImageUrl ?? null,
    logoImageUrl: assetsSource?.logoImageUrl ?? null,
    logoPosition: null,
    coverImageUrl: null,
    downloadSources: [],
  };

  await gamesShopAssetsSublevel
    .put(levelKeys.game(shop, objectId), { ...assets, updatedAt: Date.now() })
    .catch((err) => {
      logger.error("Could not cache launchbox assets", err);
    });

  const platform =
    entry.platform ?? entry.data?.platform ?? defaultPlatform ?? null;

  // Art also lives on the game record: profile syncs reset the shop-assets cache to null for
  // classics, and get-library falls back to these fields (PS2 has its own backfill for that).
  const coverUrl = assetsSource?.libraryImageUrl ?? null;
  const heroUrl = assetsSource?.libraryHeroImageUrl ?? coverUrl;
  const tile = tileUrl ?? (platformToSystem(platform) === "switch" ? coverUrl : null);

  const existing = await gamesSublevel.get(gameKey);
  if (existing) {
    await clearFinishedDownload(shop, objectId);
    existing.isDeleted = false;
    existing.addedToLibraryAt ??= new Date();
    if (platform && !existing.platform) {
      existing.platform = platform;
    }
    if (coverUrl) existing.coverImageUrl = coverUrl;
    if (heroUrl) existing.libraryHeroImageUrl = heroUrl;
    if (tile) existing.tileImageUrl = tile;
    // A game first imported under its file name gets the catalogue title once it's recognised.
    const catalogueTitle = entry.data?.title;
    const fileName = discs[0]?.fileName;
    if (catalogueTitle && fileName && isFileNameTitle(existing.title, fileName)) {
      existing.title = catalogueTitle;
    }
    existing.discs = discs;
    if (
      !existing.selectedDiscPath ||
      !discs.some((d) => d.path === existing.selectedDiscPath)
    ) {
      existing.selectedDiscPath = discs[0]?.path ?? null;
    }
    existing.romSizeBytes = romSizeBytes ?? existing.romSizeBytes ?? null;
    await gamesSublevel.put(gameKey, existing);
  } else {
    await gamesSublevel.put(gameKey, {
      title: entry.data?.title ?? assets.title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: heroUrl,
      coverImageUrl: coverUrl,
      tileImageUrl: tile,
      logoImageUrl: assets.logoImageUrl,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      platform,
      discs,
      selectedDiscPath: discs[0]?.path ?? null,
      romSizeBytes,
    });
  }

  AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);
};

export const syncProfileBatch = async (
  objectIds: string[],
  signal?: AbortSignal
) => {
  if (objectIds.length === 0) return;

  const chunks = chunk(objectIds, PROFILE_BATCH_CHUNK_SIZE);
  const syncedObjectIds: string[] = [];

  for (const objectIdChunk of chunks) {
    if (signal?.aborted) break;
    const payload = objectIdChunk.map((objectId) => ({
      objectId,
      shop: "launchbox",
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
    }));
    try {
      await HydraApi.post("/profile/games/batch", payload, { signal });
      syncedObjectIds.push(...objectIdChunk);
    } catch (err) {
      if (signal?.aborted) break;
      logger.error("Failed to batch-sync launchbox games to profile", err);
    }
  }

  await mergeImportedProfileGames("launchbox", syncedObjectIds);
};

const persistRomFolder = async (
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean,
  fileCount: number,
  sizeBytes: number
) => {
  await emulators.updateEmulatorConfig(system, (current) => {
    const existing = current.romFolders.find((f) => f.path === folderPath);
    const updated: RomFolder = {
      id: existing?.id ?? randomUUID(),
      path: folderPath,
      scanSubfolders,
      fileCount,
      sizeBytes,
      lastScanAt: Date.now(),
    };

    const nextFolders = existing
      ? current.romFolders.map((f) => (f.path === folderPath ? updated : f))
      : [...current.romFolders, updated];

    return emulators.recomputeTotals({
      ...current,
      romFolders: nextFolders,
    });
  });
};

// Adds a folder that is not registered yet, leaving an already-known folder's
// counts alone so a rescan never resets them.
export const ensureRomFolderRegistered = async (
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean
) => {
  await emulators.updateEmulatorConfig(system, (current) => {
    if (current.romFolders.some((f) => f.path === folderPath)) return current;

    const folder: RomFolder = {
      id: randomUUID(),
      path: folderPath,
      scanSubfolders,
      fileCount: 0,
      sizeBytes: 0,
      lastScanAt: null,
    };

    return emulators.recomputeTotals({
      ...current,
      romFolders: [...current.romFolders, folder],
    });
  });
};

export type ProgressPhase = "scanning" | "matching";

export type UnmatchedReason = "wrong_platform" | "unmatched";

export interface UnmatchedFile {
  name: string;
  reason: UnmatchedReason;
}

export type LaunchboxImportProgress = {
  type: "progress";
  phase: ProgressPhase;
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | UnmatchedReason | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
};

const SCAN_BAND = 15;
const EXTRACT_BAND = 70;

export interface LaunchboxImportResult {
  fileCount: number;
  sizeBytes: number;
  matched: number;
  unmatched: number;
  unmatchedFiles: UnmatchedFile[];
  cancelled: boolean;
}

type ScannedGameInfo = {
  folderPath: string;
  primaryPath: string;
  name: string;
  sizeBytes: number;
  wrongPlatform: boolean;
};

interface GameSku {
  game: ScannedGameInfo;
  sku: string | null;
}

interface EnrichedGame {
  game: ScannedGameInfo;
  sku: string | null;
  entry: LaunchboxShopDetailsEntry | null;
  groupKey: string;
  reason: "matched" | UnmatchedReason;
}

type SkuLookup = Awaited<ReturnType<typeof fetchShopDetailsForSkus>>;
type TitleByFolder = Map<string, { folderPath: string; sizeBytes: number }>;
type DiscsByTitle = Map<
  string,
  { primaryPath: string; name: string; sku: string | null }[]
>;
type UnmatchedGroups = Map<
  string,
  {
    folderPath: string;
    sizeBytes: number;
    files: { primaryPath: string; name: string; sku: string | null }[];
  }
>;
type ProgressFn = (payload: LaunchboxImportProgress) => void;

const cancelledResult = (
  fileCount = 0,
  sizeBytes = 0,
  matched = 0,
  unmatched = 0,
  unmatchedFiles: UnmatchedFile[] = []
): LaunchboxImportResult => ({
  fileCount,
  sizeBytes,
  matched,
  unmatched,
  unmatchedFiles,
  cancelled: true,
});

type ScanReporter = (
  processed: number,
  total: number,
  currentFile: string | null,
  kept: number
) => void;

const scanFolders = async (
  system: EmulatorSystem,
  folders: FolderInput[],
  signal: CancelSignal,
  onScan?: ScanReporter
): Promise<ScannedGameInfo[]> => {
  const binary = emulators.KNOWN_BINARIES[system];

  const folderTotals: number[] = [];
  let scanTotal = 0;
  const hasMultipleFolders = folders.length > 1;
  if (hasMultipleFolders) {
    for (const folder of folders) {
      if (signal.cancelled) break;
      const count = await emulators.countRomGroups(
        folder.path,
        binary,
        folder.scanSubfolders,
        signal
      );
      folderTotals.push(count);
      scanTotal += count;
    }
  }

  let scanBase = 0;
  let keptTotal = 0;
  const collected: ScannedGameInfo[] = [];

  for (let fi = 0; fi < folders.length; fi++) {
    if (signal.cancelled) break;
    const folder = folders[fi];

    const partial = await emulators.scanRomFolder(
      folder.path,
      binary,
      folder.scanSubfolders,
      {
        signal,
        onProgress: (p) => {
          onScan?.(
            scanBase + p.processed,
            hasMultipleFolders ? scanTotal : p.total,
            p.currentFile,
            keptTotal + p.kept
          );
        },
      }
    );

    scanBase += folderTotals[fi] ?? partial.games.length;
    keptTotal += partial.games.length;
    for (const game of partial.games) {
      collected.push({ folderPath: folder.path, ...game });
    }
  }

  return collected;
};

const resolveSkus = async (
  system: EmulatorSystem,
  collected: ScannedGameInfo[],
  signal: CancelSignal,
  onExtract?: (processed: number, total: number, currentFile: string) => void
): Promise<{
  gameSkus: GameSku[];
  ps3Exe: string | null;
  ps3ExtractedForYml: Map<string, string>;
}> => {
  const gameSkus: GameSku[] = [];
  const ps3ExtractedForYml = new Map<string, string>();
  let ps3Exe: string | null = null;
  let ps3PathIndex: Map<string, string> | null = null;

  if (system === "ps3") {
    const cfg = await emulators.getEmulatorConfig("ps3");
    ps3Exe = cfg.executablePath;
    ps3PathIndex = emulators.buildPathToTitleIdIndex(
      await emulators.readGamesYml(ps3Exe)
    );
  }

  for (let i = 0; i < collected.length; i++) {
    if (signal.cancelled) break;
    const game = collected[i];

    let sku: string | null = null;
    if (!game.wrongPlatform) {
      sku = ps3PathIndex ? lookupYmlSku(ps3PathIndex, game.primaryPath) : null;
      const fromYml = sku !== null;
      if (!sku) {
        sku = await emulators.extractDiscSku(game.primaryPath, system);
        if (system === "ps3" && sku) {
          ps3ExtractedForYml.set(
            normalizeSku(sku),
            ymlValueForGame(game.primaryPath)
          );
        }
      }

      logger.log("[launchbox-import] SKU extract", {
        system,
        file: game.primaryPath,
        sku,
        source: fromYml ? "games.yml" : "disc",
      });
    }
    // A Switch dump named without tags can still turn out to be an update/DLC once its
    // ticket is read; those never become games.
    // A base dump named with its update's ID ("…800" but "[v0]") is the game itself.
    if (system === "switch" && sku && contentKindOfTitleId(sku) === "update" && /\[v0\]/i.test(game.name)) {
      sku = `${sku.replace(/[^0-9a-f]/gi, "").slice(0, 13)}000`.toUpperCase();
    }
    if (system === "switch" && sku && contentKindOfTitleId(sku) !== "base") {
      onExtract?.(i + 1, collected.length, game.name);
      continue;
    }
    gameSkus.push({ game, sku });
    onExtract?.(i + 1, collected.length, game.name);
  }

  return { gameSkus, ps3Exe, ps3ExtractedForYml };
};

const buildEnriched = (
  system: EmulatorSystem,
  gameSkus: GameSku[],
  skuLookup: SkuLookup
): {
  enriched: EnrichedGame[];
  groupCanonical: Map<string, LaunchboxShopDetailsEntry>;
} => {
  const enriched: EnrichedGame[] = gameSkus.map(({ game, sku }) => {
    const groupKey =
      system === "ps3"
        ? game.primaryPath
        : `${game.folderPath}::${stripDiscMarker(game.name)}`;

    if (game.wrongPlatform) {
      logger.log("[launchbox-import] match", {
        file: game.primaryPath,
        sku,
        matched: false,
        reason: "wrong_platform",
        source: "sniff",
        groupKey,
      });
      return { game, sku, entry: null, groupKey, reason: "wrong_platform" };
    }

    const entry = sku ? (skuLookup.get(normalizeSku(sku)) ?? null) : null;
    const platformOk = entry
      ? entryMatchesSystemPlatform(entry, system)
      : false;
    const hasEntry = Boolean(entry?.objectId && entry?.data);
    const success = hasEntry && platformOk;
    const reason: "matched" | UnmatchedReason = success
      ? "matched"
      : hasEntry
        ? "wrong_platform"
        : "unmatched";
    logger.log("[launchbox-import] match", {
      file: game.primaryPath,
      sku,
      normalizedSku: sku ? normalizeSku(sku) : null,
      matched: success,
      reason,
      platform: entry?.platform ?? entry?.data?.platform ?? null,
      platformOk,
      objectId: success ? entry?.objectId : null,
      title: success ? entry?.data?.title : null,
      groupKey,
    });
    return { game, sku, entry: success ? entry : null, groupKey, reason };
  });

  const groupCanonical = new Map<string, LaunchboxShopDetailsEntry>();
  for (const { entry, groupKey } of enriched) {
    if (entry && !groupCanonical.has(groupKey)) {
      groupCanonical.set(groupKey, entry);
    }
  }

  return { enriched, groupCanonical };
};

const aggregateMatches = (
  enriched: EnrichedGame[],
  groupCanonical: Map<string, LaunchboxShopDetailsEntry>,
  signal: CancelSignal,
  onMatch?: (
    processed: number,
    total: number,
    currentFile: string,
    status: "matched" | UnmatchedReason,
    matched: number,
    sizeBytes: number
  ) => void
): {
  unmatched: number;
  unmatchedFiles: UnmatchedFile[];
  titleByFolder: TitleByFolder;
  discsByTitle: DiscsByTitle;
  unmatchedGroups: UnmatchedGroups;
} => {
  let unmatched = 0;
  const unmatchedFiles: UnmatchedFile[] = [];
  const seenUnmatchedGroups = new Set<string>();
  const titleByFolder: TitleByFolder = new Map();
  const discsByTitle: DiscsByTitle = new Map();
  // Groups that matched nothing in the catalogue but are still real ROMs — collected so they can
  // be added to the library under their filename (bootlegs/mods never appear in any catalogue).
  const unmatchedGroups: UnmatchedGroups = new Map();
  let matchedSizeBytes = 0;

  for (let i = 0; i < enriched.length; i++) {
    if (signal.cancelled) break;
    const { game, sku, groupKey, reason } = enriched[i];
    const canonical = groupCanonical.get(groupKey);

    if (canonical) {
      const titleKey = canonical.objectId;
      const existing = titleByFolder.get(titleKey);
      if (existing) {
        existing.sizeBytes += game.sizeBytes;
      } else {
        titleByFolder.set(titleKey, {
          folderPath: game.folderPath,
          sizeBytes: game.sizeBytes,
        });
      }
      matchedSizeBytes += game.sizeBytes;

      const discsForTitle = discsByTitle.get(titleKey) ?? [];
      if (!discsForTitle.some((d) => d.primaryPath === game.primaryPath)) {
        discsForTitle.push({
          primaryPath: game.primaryPath,
          name: game.name,
          sku,
        });
      }
      discsByTitle.set(titleKey, discsForTitle);
    } else {
      if (!seenUnmatchedGroups.has(groupKey)) {
        seenUnmatchedGroups.add(groupKey);
        unmatched += 1;
        unmatchedFiles.push({
          name: game.name,
          reason: reason === "matched" ? "unmatched" : reason,
        });
      }

      // A file sniffed as the wrong platform stays out of this system's library; a plain
      // "unmatched" ROM is a real game for this system that just isn't in the catalogue.
      if (reason !== "wrong_platform") {
        const group = unmatchedGroups.get(groupKey) ?? {
          folderPath: game.folderPath,
          sizeBytes: 0,
          files: [],
        };
        if (!group.files.some((f) => f.primaryPath === game.primaryPath)) {
          group.files.push({
            primaryPath: game.primaryPath,
            name: game.name,
            sku,
          });
          group.sizeBytes += game.sizeBytes;
        }
        unmatchedGroups.set(groupKey, group);
      }
    }

    onMatch?.(
      i + 1,
      enriched.length,
      game.name,
      canonical ? "matched" : reason,
      titleByFolder.size,
      matchedSizeBytes
    );
  }

  return { unmatched, unmatchedFiles, titleByFolder, discsByTitle, unmatchedGroups };
};

const rollupFolders = (
  folders: FolderInput[],
  titleByFolder: TitleByFolder,
  unmatchedGroups: UnmatchedGroups
): {
  folderRollup: Map<string, { fileCount: number; sizeBytes: number }>;
  totalFileCount: number;
  totalSizeBytes: number;
} => {
  const folderRollup = new Map<
    string,
    { fileCount: number; sizeBytes: number }
  >();
  for (const folder of folders) {
    folderRollup.set(folder.path, { fileCount: 0, sizeBytes: 0 });
  }
  // Count catalogue matches and filename-only (unmatched) games alike — both are real library
  // entries now, so the settings "games found" total reflects everything the user can see.
  const contributions = [
    ...[...titleByFolder.values()].map((v) => ({
      folderPath: v.folderPath,
      sizeBytes: v.sizeBytes,
    })),
    ...[...unmatchedGroups.values()].map((g) => ({
      folderPath: g.folderPath,
      sizeBytes: g.sizeBytes,
    })),
  ];
  for (const { folderPath, sizeBytes } of contributions) {
    const bucket = folderRollup.get(folderPath);
    if (bucket) {
      bucket.fileCount += 1;
      bucket.sizeBytes += sizeBytes;
    }
  }

  let totalFileCount = 0;
  let totalSizeBytes = 0;
  for (const bucket of folderRollup.values()) {
    totalFileCount += bucket.fileCount;
    totalSizeBytes += bucket.sizeBytes;
  }

  return { folderRollup, totalFileCount, totalSizeBytes };
};

const persistMatchedEntries = async (
  matchedEntries: Map<string, LaunchboxShopDetailsEntry>,
  discsByTitle: DiscsByTitle,
  titleByFolder: TitleByFolder,
  language: string,
  system: EmulatorSystem,
  signal: CancelSignal
) => {
  for (const entry of matchedEntries.values()) {
    if (signal.cancelled) break;
    const titleDiscs = discsByTitle.get(entry.objectId) ?? [];
    const discs = buildDiscList(titleDiscs);
    const romSizeBytes = titleByFolder.get(entry.objectId)?.sizeBytes ?? null;
    await persistEntryLocally(
      entry,
      language,
      discs,
      SYSTEM_DEFAULT_PLATFORM[system],
      romSizeBytes
    ).catch((err) => {
      logger.error("Failed to persist launchbox entry locally", err);
    });
  }
};

/**
 * Adds a ROM that matched nothing in the catalogue to the library under its filename. Bootlegs and
 * ROM hacks (Bomba Patch, MyMax, …) never appear in LaunchBox/GameTDB, so without this they'd scan
 * fine yet never show up — the reported bug. A stable id derived from the group means a rescan
 * updates the same entry instead of duplicating it.
 */
// Box art for a PS2 disc serial from the community xlenore/ps2-covers repo (served via jsDelivr).
// The extracted serial is already in the repo's `XXXX-NNNNN` shape, so the match is exact; a serial
// with no cover in the repo just 404s and the UI falls back to its placeholder.
// Community box-art repos keyed by disc serial ("SLUS-01042").
const COVER_REPOS: Partial<Record<EmulatorSystem, string>> = {
  ps1: "xlenore/psx-covers",
  ps2: "xlenore/ps2-covers",
};

const discCoverUrl = (
  system: EmulatorSystem,
  serial: string | null | undefined
): string | null => {
  const repo = COVER_REPOS[system];
  return repo && serial && /^[A-Z]{4}-\d{5}$/.test(serial)
    ? `https://cdn.jsdelivr.net/gh/${repo}@main/covers/default/${serial}.jpg`
    : null;
};

// libretro-thumbnails folders for systems whose dumps no catalogue names (art matched by title).
const LIBRETRO_FOLDERS: Partial<Record<EmulatorSystem, string>> = {
  ps1: "Sony - PlayStation",
  ps3: "Sony - PlayStation 3",
  "3ds": "Nintendo - Nintendo 3DS",
};

/**
 * PS3 disc folders are found by their "PS3_GAME" marker, whose name says nothing: the real title
 * is in PS3_GAME/PARAM.SFO, else the game's own folder ("Demon's Souls [BLUS30443]").
 */
const ps3GameTitle = async (markerPath: string): Promise<string | null> => {
  if (!/^ps3_game$/i.test(path.basename(markerPath))) return null;
  const sfo = await fs.readFile(path.join(markerPath, "PARAM.SFO")).catch(() => null);
  const title = sfo ? emulators.parseParamSfoValue(sfo, "TITLE", true) : null;
  return title || cleanRomTitle(path.basename(path.dirname(markerPath)));
};

const urlResponds = (url: string) =>
  axios
    .head(url, { timeout: 8000, validateStatus: () => true })
    .then((response) => response.status === 200)
    .catch(() => false);

/**
 * Title and art for a ROM no catalogue matched by serial:
 * - Switch dumps the Title ID lookup didn't cover (most .xci have none): official name + art by
 *   exact title (server).
 * - PS1/PS3/3DS: box art by serial when a cover repo has it, else libretro-thumbnails by title,
 *   plus the title screen for the Início strip.
 * - Others: the serial cover repo, as before.
 */
/** Art PS3 disc folders ship with: ICON0 (icon) and PIC1 (1920x1080 background). */
const ps3LocalArt = (markerPath: string | undefined) => {
  if (!markerPath || !/^ps3_game$/i.test(path.basename(markerPath))) return { icon: null, pic: null };
  const icon = path.join(markerPath, "ICON0.PNG");
  const pic = path.join(markerPath, "PIC1.PNG");
  return { icon: existsSync(icon) ? icon : null, pic: existsSync(pic) ? pic : null };
};

const resolveUnmatchedArt = async (
  system: EmulatorSystem,
  serial: string | null | undefined,
  title: string,
  primaryPath?: string
): Promise<{
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  tileUrl: string | null;
}> => {
  if (system === "switch") {
    const found = await HydraApi.post<{
      title: string;
      coverUrl: string | null;
      heroUrl: string | null;
    } | null>("/games/switch/search", { title }, { needsAuth: false }).catch(() => null);
    return found
      ? { title: found.title, coverUrl: found.coverUrl, heroUrl: found.heroUrl, tileUrl: found.coverUrl }
      : { title, coverUrl: null, heroUrl: null, tileUrl: null };
  }

  const serialCover = discCoverUrl(system, serial);
  const libretroFolder = LIBRETRO_FOLDERS[system];
  if (libretroFolder) {
    // Boxes carry spines/labels that look off in the Início square; the title screen doesn't.
    const tileUrl = await findLibretroTitleScreen(libretroFolder, title).catch(() => null);
    if (serialCover && (await urlResponds(serialCover))) {
      return { title, coverUrl: serialCover, heroUrl: null, tileUrl };
    }
    const fallback = await findLibretroBoxart(libretroFolder, title).catch(() => null);
    if (system === "ps3") {
      const local = ps3LocalArt(primaryPath);
      return {
        title,
        coverUrl: fallback ?? local.icon,
        heroUrl: local.pic,
        tileUrl: tileUrl ?? local.icon,
      };
    }
    return { title, coverUrl: fallback, heroUrl: null, tileUrl };
  }
  return { title, coverUrl: serialCover, heroUrl: null, tileUrl: null };
};

const persistUnmatchedGame = async (
  objectId: string,
  title: string,
  /** The ROM file name: titles older scans derived from it are replaced, user edits are kept. */
  sourceFileName: string,
  discs: ClassicsDisc[],
  system: EmulatorSystem,
  romSizeBytes: number | null,
  coverUrl: string | null,
  /** Wide art for the hero; the box art doubles as hero when there is none. */
  heroUrl: string | null = null,
  tileUrl: string | null = null
) => {
  const shop = "launchbox" as const;
  const gameKey = levelKeys.game(shop, objectId);
  const platform = SYSTEM_DEFAULT_PLATFORM[system];

  await gamesShopAssetsSublevel
    .put(gameKey, {
      objectId,
      shop,
      title,
      iconUrl: null,
      libraryHeroImageUrl: heroUrl ?? coverUrl,
      libraryImageUrl: coverUrl,
      logoImageUrl: null,
      logoPosition: null,
      coverImageUrl: coverUrl,
      downloadSources: [],
      updatedAt: Date.now(),
    })
    .catch((err) => logger.error("Could not cache unmatched rom assets", err));

  const existing = await gamesSublevel.get(gameKey);
  if (existing) {
    await clearFinishedDownload(shop, objectId);
    existing.isDeleted = false;
    existing.addedToLibraryAt ??= new Date();
    if (isFileNameTitle(existing.title, sourceFileName)) existing.title = title;
    if (platform && !existing.platform) existing.platform = platform;
    if (coverUrl) {
      existing.libraryHeroImageUrl = heroUrl ?? coverUrl;
      existing.coverImageUrl = coverUrl;
    }
    if (tileUrl) existing.tileImageUrl = tileUrl;
    existing.discs = discs;
    if (
      !existing.selectedDiscPath ||
      !discs.some((d) => d.path === existing.selectedDiscPath)
    ) {
      existing.selectedDiscPath = discs[0]?.path ?? null;
    }
    existing.romSizeBytes = romSizeBytes ?? existing.romSizeBytes ?? null;
    await gamesSublevel.put(gameKey, existing);
  } else {
    await gamesSublevel.put(gameKey, {
      title,
      iconUrl: null,
      libraryHeroImageUrl: heroUrl ?? coverUrl,
      coverImageUrl: coverUrl,
      tileImageUrl: tileUrl,
      logoImageUrl: null,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      platform,
      discs,
      selectedDiscPath: discs[0]?.path ?? null,
      romSizeBytes,
    });
  }
};

const persistUnmatchedGames = async (
  unmatchedGroups: UnmatchedGroups,
  system: EmulatorSystem,
  signal: CancelSignal
): Promise<Set<string>> => {
  const persistedIds = new Set<string>();
  for (const [groupKey, group] of unmatchedGroups) {
    if (signal.cancelled) break;
    if (group.files.length === 0) continue;

    const discs = buildDiscList(group.files);
    // Stable, collision-free id: a serial keeps a rescan pointing at the same entry; otherwise the
    // group key (folder + disc-stripped name) does. Prefixed so it never clashes with a real
    // LaunchBox catalogue id if the game is later matched properly.
    const serial = group.files.find((f) => f.sku)?.sku;
    const objectId = serial
      ? `rom-sku-${normalizeSku(serial)}`
      : `rom-${createHash("sha1").update(groupKey).digest("hex").slice(0, 16)}`;
    const sourceFileName = group.files[0].name;
    const art = await resolveUnmatchedArt(
      system,
      serial,
      (system === "ps3" ? await ps3GameTitle(group.files[0].primaryPath) : null) ??
        cleanRomTitle(sourceFileName),
      group.files[0].primaryPath
    );
    const title = art.title;
    persistedIds.add(objectId);
    const { coverUrl, heroUrl, tileUrl } = art;

    await persistUnmatchedGame(
      objectId,
      title,
      sourceFileName,
      discs,
      system,
      group.sizeBytes || null,
      coverUrl,
      heroUrl,
      tileUrl
    ).catch((err) =>
      logger.error("Failed to persist unmatched rom locally", err)
    );
  }
  return persistedIds;
};

const persistFolderRollups = async (
  system: EmulatorSystem,
  folderRollup: Map<string, { fileCount: number; sizeBytes: number }>,
  folderInputBy: Map<string, FolderInput>,
  signal: CancelSignal
) => {
  for (const [folderPath, rollup] of folderRollup) {
    if (signal.cancelled) break;
    const input = folderInputBy.get(folderPath);
    if (!input) continue;
    await persistRomFolder(
      system,
      input.path,
      input.scanSubfolders,
      rollup.fileCount,
      rollup.sizeBytes
    ).catch((err) => {
      logger.error("Could not persist rom folder", err);
    });
  }
};

const reconcileDeletedGames = async (
  system: EmulatorSystem,
  folders: FolderInput[],
  signal: CancelSignal,
  /** Every game this scan produced; null skips the check (e.g. a partial scan). */
  scannedIds: Set<string> | null = null
) => {
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (signal.cancelled) break;
    if (game.isDeleted) continue;
    if (game.shop !== "launchbox") continue;
    if (platformToSystem(game.platform) !== system) continue;

    const discs = game.discs ?? [];
    const inScannedFolders = discs.some((disc) =>
      folders.some((folder) => isWithin(disc.path, folder.path))
    );
    if (!inScannedFolders) continue;

    const stillOnDisk = discs.some((disc) => existsSync(disc.path));
    // Entries an older scan created from files that aren't games on their own (a cue's
    // "Track 2.bin", a duplicate "Game.cue.cue") stay on disk but no scan produces them anymore.
    // Hidden, never removed from disk; anything with playtime is left alone.
    const orphaned =
      scannedIds !== null &&
      !scannedIds.has(game.objectId) &&
      !(game.playTimeInMilliseconds > 0) &&
      discs.every((disc) => folders.some((folder) => isWithin(disc.path, folder.path)));
    if (stillOnDisk && !orphaned) continue;

    game.isDeleted = true;
    await gamesSublevel.put(key, game).catch((err) => {
      logger.error("Could not mark stale launchbox game as deleted", err);
    });
  }
};

/**
 * Games of a console whose files sit outside every folder still linked to it: the folder was
 * unlinked (or linked by mistake, like a whole drive). They leave the library and the profile;
 * the record is only hidden, so linking the folder again brings them back with their playtime.
 */
export const hideGamesOutsideRomFolders = async (
  system: EmulatorSystem,
  folderPaths: string[]
): Promise<number> => {
  let hidden = 0;
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (game.isDeleted || game.shop !== "launchbox") continue;
    if (platformToSystem(game.platform) !== system) continue;
    const discs = game.discs ?? [];
    if (discs.length === 0) continue;
    const linked = discs.some((disc) =>
      folderPaths.some((folder) => isWithin(disc.path, folder))
    );
    if (linked) continue;

    await gamesSublevel.put(key, { ...game, isDeleted: true }).catch((err) => {
      logger.error("Could not hide game outside the linked folders", err);
    });
    if (game.remoteId) {
      HydraApi.delete(`/profile/games/${game.remoteId}`).catch(() => {});
    }
    hidden += 1;
  }
  if (hidden > 0) {
    logger.info("Hid games outside the linked rom folders", { system, hidden });
  }
  return hidden;
};

export async function runLaunchboxImport(
  system: EmulatorSystem,
  folders: FolderInput[],
  language: string,
  signal: CancelSignal,
  onProgress?: ProgressFn
): Promise<LaunchboxImportResult> {
  const folderInputBy = new Map(folders.map((f) => [f.path, f]));

  // Linking games is all a user has to do: a console without an emulator gets one set up in the
  // background (official build, checked download) while the games are read.
  void autoSetupEmulator(system).catch(() => {});
  // Broken .cue files (renamed .bin) would import fine but never boot: fix them first.
  if (system === "ps1" || system === "ps2") {
    for (const folder of folders) repairCuesInFolder(folder.path, folder.scanSubfolders);
  }

  // Register the folders up front with empty counts. A cancelled scan returns
  // before the rollup is persisted, and the user still expects the folder they
  // picked to be listed - just with no games detected yet.
  for (const folder of folders) {
    if (signal.cancelled) return cancelledResult();
    await ensureRomFolderRegistered(system, folder.path, folder.scanSubfolders);
  }

  const collected = await scanFolders(
    system,
    folders,
    signal,
    (processed, total, currentFile, kept) =>
      onProgress?.({
        type: "progress",
        phase: "scanning",
        processed,
        total,
        percent: bandPercent(0, SCAN_BAND, processed, total),
        currentFile,
        status: null,
        discovered: kept,
        matched: 0,
        sizeBytes: 0,
      })
  );
  if (signal.cancelled) return cancelledResult();
  const totalGames = collected.length;

  const { gameSkus, ps3Exe, ps3ExtractedForYml } = await resolveSkus(
    system,
    collected,
    signal,
    (processed, total, currentFile) =>
      onProgress?.({
        type: "progress",
        phase: "matching",
        processed,
        total,
        percent: bandPercent(SCAN_BAND, EXTRACT_BAND, processed, total),
        currentFile,
        status: null,
        discovered: totalGames,
        matched: 0,
        sizeBytes: 0,
      })
  );
  if (signal.cancelled) return cancelledResult();

  const uniqueSkus = Array.from(
    new Set(
      gameSkus
        .map((g) => g.sku)
        .filter((s): s is string => s !== null && s.length > 0)
    )
  );
  const skuLookup = await fetchShopDetailsForSkus(
    uniqueSkus,
    language,
    signal.abortController?.signal
  );
  if (signal.cancelled) return cancelledResult();

  const { enriched, groupCanonical } = buildEnriched(
    system,
    gameSkus,
    skuLookup
  );

  const matchedEntries = new Map<string, LaunchboxShopDetailsEntry>();
  for (const entry of groupCanonical.values()) {
    matchedEntries.set(entry.objectId, entry);
  }
  const matched = matchedEntries.size;

  const { unmatched, unmatchedFiles, titleByFolder, discsByTitle, unmatchedGroups } =
    aggregateMatches(
      enriched,
      groupCanonical,
      signal,
      (processed, total, currentFile, status, runningMatched, sizeBytes) =>
        onProgress?.({
          type: "progress",
          phase: "matching",
          processed,
          total,
          percent: bandPercent(
            SCAN_BAND + EXTRACT_BAND,
            100 - (SCAN_BAND + EXTRACT_BAND),
            processed,
            total
          ),
          currentFile,
          status,
          discovered: totalGames,
          matched: runningMatched,
          sizeBytes,
        })
    );

  const { folderRollup, totalFileCount, totalSizeBytes } = rollupFolders(
    folders,
    titleByFolder,
    unmatchedGroups
  );

  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matched,
      unmatched,
      unmatchedFiles
    );
  }

  await persistMatchedEntries(
    matchedEntries,
    discsByTitle,
    titleByFolder,
    language,
    system,
    signal
  );
  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matched,
      unmatched,
      unmatchedFiles
    );
  }

  // Add every ROM that matched no catalogue entry to the library under its filename, so bootlegs
  // and mods (which no catalogue has) still show up instead of silently vanishing after a scan.
  const unmatchedIds = await persistUnmatchedGames(unmatchedGroups, system, signal);
  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matched,
      unmatched,
      unmatchedFiles
    );
  }

  await persistFolderRollups(system, folderRollup, folderInputBy, signal);
  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matched,
      unmatched,
      unmatchedFiles
    );
  }

  await reconcileDeletedGames(
    system,
    folders,
    signal,
    new Set([...matchedEntries.keys(), ...unmatchedIds])
  );
  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matched,
      unmatched,
      unmatchedFiles
    );
  }

  await syncProfileBatch(
    Array.from(matchedEntries.keys()),
    signal.abortController?.signal
  );

  if (system === "ps3" && !signal.cancelled && ps3ExtractedForYml.size > 0) {
    await emulators
      .mergeWriteGamesYml(ps3Exe, ps3ExtractedForYml)
      .catch((err) => logger.error("Could not merge-write games.yml", err));
  }

  return {
    fileCount: totalFileCount,
    sizeBytes: totalSizeBytes,
    matched,
    unmatched,
    unmatchedFiles,
    cancelled: signal.cancelled,
  };
}

const CLASSICS_IMPORT_PROGRESS_CHANNEL = "on-classics-import-progress";

const importLaunchboxRoms = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folders: FolderInput[],
  language: string
) => {
  const requestId = randomUUID();
  const signal: CancelSignal = {
    cancelled: false,
    abortController: new AbortController(),
  };
  inflight.set(requestId, signal);

  setActiveClassicsImport({
    requestId,
    system,
    phase: "scanning",
    processed: 0,
    total: 0,
    percent: 0,
    currentFile: null,
    status: null,
    discovered: 0,
    matched: 0,
    sizeBytes: 0,
  });
  WindowManager.sendToAppWindows("on-classics-import-status", true);

  void (async () => {
    try {
      const result = await runLaunchboxImport(
        system,
        folders,
        language,
        signal,
        (payload) => {
          updateActiveClassicsImport({
            phase: payload.phase,
            processed: payload.processed,
            total: payload.total,
            percent: payload.percent,
            currentFile: payload.currentFile,
            status: payload.status,
            discovered: payload.discovered,
            matched: payload.matched,
            sizeBytes: payload.sizeBytes,
          });
          WindowManager.sendToAppWindows(CLASSICS_IMPORT_PROGRESS_CHANNEL, {
            requestId,
            system,
            ...payload,
          });
        }
      );

      WindowManager.sendToAppWindows(CLASSICS_IMPORT_PROGRESS_CHANNEL, {
        type: result.cancelled ? "cancelled" : "done",
        requestId,
        system,
        fileCount: result.fileCount,
        sizeBytes: result.sizeBytes,
        matched: result.matched,
        unmatched: result.unmatched,
        unmatchedFiles: result.unmatchedFiles,
      });
    } catch (err) {
      WindowManager.sendToAppWindows(CLASSICS_IMPORT_PROGRESS_CHANNEL, {
        type: "error",
        requestId,
        system,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight.delete(requestId);
      setActiveClassicsImport(null);
      WindowManager.sendToAppWindows("on-classics-import-status", false);
    }
  })();

  return { requestId };
};

const cancelLaunchboxImport = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
) => {
  const signal = inflight.get(requestId);
  if (signal) {
    signal.cancelled = true;
    signal.abortController?.abort();
  }
};

registerEvent("importLaunchboxRoms", importLaunchboxRoms);
registerEvent("cancelLaunchboxImport", cancelLaunchboxImport);
