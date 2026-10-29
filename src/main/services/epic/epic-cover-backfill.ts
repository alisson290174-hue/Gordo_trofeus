import axios from "axios";

import { gamesSublevel } from "@main/level";
import { measure, saveSizes } from "../emulators/classic-fanart";
import { isConfidentTitleMatch } from "../folder-game-finder-core";
import { logger } from "../logger";

/**
 * Some Epic games only publish a near-square key art (1280x1440) as their "tall" image, which the
 * library has to crop hard into a 2:3 case. When that happens and the same game is on Steam, its
 * official vertical capsule (600x900) becomes the case — saved as boxArtImageUrl, which the
 * covers already prefer and the Epic sync never overwrites.
 */

const MAX_CASE_RATIO = 0.8;
const steamCapsule = (appid: number) =>
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900_2x.jpg`;

const findOnSteam = async (title: string) => {
  const { data } = await axios.get<{
    items?: { id: number; name: string; type: string }[];
  }>("https://store.steampowered.com/api/storesearch/", {
    params: { term: title, cc: "us", l: "english" },
    timeout: 10_000,
  });
  return (data.items ?? []).find(
    (item) => item.type === "app" && isConfidentTitleMatch(title, item.name)
  );
};

export const backfillEpicCovers = async () => {
  let fixed = 0;
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (game.shop !== "epic" || game.isDeleted) continue;
    if (game.customCoverImageUrl || game.boxArtImageUrl || !game.coverImageUrl)
      continue;

    const size = await measure(game.coverImageUrl);
    if (!size || size.width / size.height <= MAX_CASE_RATIO) continue;

    const match = await findOnSteam(game.title).catch(() => null);
    if (!match) continue;
    const capsule = steamCapsule(match.id);
    const capsuleSize = await measure(capsule);
    if (!capsuleSize || capsuleSize.width / capsuleSize.height > MAX_CASE_RATIO)
      continue;

    await gamesSublevel.put(key, { ...game, boxArtImageUrl: capsule });
    fixed += 1;
    logger.info(
      `[epic-covers] ${game.title}: vertical case from Steam ${match.id}`
    );
  }
  saveSizes();
  return fixed;
};
