import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { emulators } from "@main/services";
import { platformToSystem } from "@main/helpers";
import { installTranslation } from "@main/services/emulators/translation-installer";
import { applyTranslationArchive } from "@main/services/emulators/rom-translations";
import { reimportAfterManualPatch } from "../emulators/rom-translation-hooks";
import type { GameShop } from "@types";

/** Title ID of a 3DS/Switch game, read from its file (3DS) or its catalogue serial (Switch). */
const resolveTitleId = async (
  system: string,
  discPath: string | null,
  sku: string | null,
  objectId: string
): Promise<string | null> => {
  if (system === "3ds" && discPath) {
    return (await emulators.read3dsHeader(discPath))?.titleId?.toUpperCase() ?? null;
  }
  const fromSku = /[0-9a-f]{16}/i.exec(sku ?? "") ?? /[0-9a-f]{16}/i.exec(objectId);
  return fromSku ? fromSku[0].toUpperCase() : null;
};

/** "Instalar tradução": a translation archive/folder the user picked, for this game only. */
const installGameTranslation = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  sourcePath: string
) => {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    return { ok: false as const, reason: "unreadable" as const };
  }
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  const system = platformToSystem(game?.platform);
  if (!game || shop !== "launchbox") {
    return { ok: false as const, reason: "unsupported_system" as const };
  }
  // Cartridge/disc consoles: the translation is a patch applied to a copy of the game.
  if (system !== "3ds" && system !== "switch") {
    const romPath = game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
    if (!romPath) return { ok: false as const, reason: "unreadable" as const };
    const result = await applyTranslationArchive({ title: game.title, platform: game.platform, romPath }, sourcePath);
    if (result.ok) void reimportAfterManualPatch(game.platform);
    return result.ok
      ? { ok: true as const, titleId: "", target: result.outputPath, fileCount: 1 }
      : { ok: false as const, reason: result.reason };
  }
  const disc = game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
  const sku = game.discs?.find((d) => d.path === disc)?.sku ?? game.discs?.[0]?.sku ?? null;
  const config = await emulators.getEmulatorConfig(system);
  return installTranslation({
    system,
    executablePath: config.executablePath,
    gameTitleId: await resolveTitleId(system, disc, sku, objectId),
    sourcePath,
  });
};

registerEvent("installGameTranslation", installGameTranslation);
