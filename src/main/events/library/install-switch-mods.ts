import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { emulators } from "@main/services";
import { platformToSystem } from "@main/helpers";
import { extractSwitchTitleId } from "@main/services/emulators/switch-title";
import {
  installSwitchMods,
  type SwitchModsResult,
} from "@main/services/emulators/switch-mods";
import type { Game, GameShop } from "@types";

const titleIdOf = async (game: Game): Promise<string | null> => {
  const disc = game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
  const sku =
    game.discs?.find((d) => d.path === disc)?.sku ??
    game.discs?.[0]?.sku ??
    null;
  const fromSku =
    /0100[0-9a-f]{12}/i.exec(sku ?? "") ??
    /0100[0-9a-f]{12}/i.exec(game.objectId);
  if (fromSku) return fromSku[0].toUpperCase();
  return disc
    ? ((await extractSwitchTitleId(disc))?.toUpperCase() ?? null)
    : null;
};

const installForGame = async (
  game: Game | undefined
): Promise<SwitchModsResult | { status: "unsupported" }> => {
  if (
    !game ||
    game.shop !== "launchbox" ||
    platformToSystem(game.platform) !== "switch"
  ) {
    return { status: "unsupported" };
  }
  const config = await emulators.getEmulatorConfig("switch");
  if (!config.executablePath) return { status: "failed" };
  const titleId = await titleIdOf(game).catch(() => null);
  return installSwitchMods(
    { titleId, title: game.title },
    config.executablePath
  );
};

/** "Instalar melhorias": 60 FPS and sharper image for one Switch game. */
registerEvent(
  "installSwitchMods",
  async (_event, shop: GameShop, objectId: string) =>
    installForGame(await gamesSublevel.get(levelKeys.game(shop, objectId)))
);

/** Same, for every Switch game in the library. */
registerEvent("installAllSwitchMods", async () => {
  const games = (await gamesSublevel.values().all()).filter(
    (game) =>
      !game.isDeleted &&
      game.shop === "launchbox" &&
      platformToSystem(game.platform) === "switch"
  );
  const results: { title: string; status: string; mods: string[] }[] = [];
  for (const game of games) {
    const result = await installForGame(game);
    results.push({
      title: game.title,
      status: result.status,
      mods: "mods" in result ? result.mods : [],
    });
  }
  return results;
});
