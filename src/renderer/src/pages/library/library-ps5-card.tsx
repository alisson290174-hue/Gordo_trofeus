import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import type { LibraryGame } from "@types";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import { Icon } from "@renderer/components/icon/icon";
import { AchievementSupportBadge } from "@renderer/components/achievement-support-badge/achievement-support-badge";
import { PlatformBadge } from "@renderer/components/platform-badge/platform-badge";
import { useGameCard } from "@renderer/hooks";
import { isGameReadyToPlay } from "@renderer/helpers";
import {
  formatHours,
  getCoverArt,
  getTrophyProgress,
} from "@renderer/helpers/ps5-game";
import CoverPlaceholder from "@renderer/assets/library-catalogue/cover-placeholder.png";
import TierBadgePlatinum from "@renderer/assets/achievements/tier-badge-platinum.png";
import "./library-ps5-card.scss";

// "unsupported" rendered as a near-invisible dark dot on every classics cover; only the
// badges that tell the player something actionable stay on the card.
const SUPPORT_BADGES_SHOWN = new Set(["working", "supported", "not_writing"]);

interface LibraryPs5CardProps {
  game: LibraryGame;
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
}

/** Biblioteca card from Conceito 1: 2:3 cover, platinum badge, trophy progress strip. */
export const LibraryPs5Card = memo(function LibraryPs5Card({
  game,
  onContextMenu,
}: Readonly<LibraryPs5CardProps>) {
  const { t, i18n } = useTranslation("dashboard");
  const { handleCardClick, handleContextMenuClick } = useGameCard(
    game,
    onContextMenu
  );

  const cover = getCoverArt(game);
  const [src, setSrc] = useState(cover ?? CoverPlaceholder);

  useEffect(() => {
    setSrc(cover ?? CoverPlaceholder);
  }, [cover]);

  const progress = getTrophyProgress(game);
  const isReady = isGameReadyToPlay(game);
  const isDownloading =
    game.download?.status === "active" || game.download?.status === "paused";
  const hours = formatHours(
    getDisplayedPlayTimeInMilliseconds(game),
    i18n.language
  );

  let subtitle: string;
  if (progress.isPlatinum) {
    subtitle = t("platinum_hours", { hours });
  } else if (progress.total > 0) {
    subtitle = `${hours} · ${progress.percent}%`;
  } else {
    subtitle = game.platform ?? hours;
  }

  return (
    <button
      type="button"
      className="ps5-card"
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
      title={game.title}
    >
      <div
        className={cn("ps5-card__cover", {
          "ps5-card__cover--platinum": progress.isPlatinum,
        })}
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setSrc(CoverPlaceholder)}
        />

        <PlatformBadge game={game} className="ps5-card__platform" />

        {progress.isPlatinum && (
          <img className="ps5-card__platinum" src={TierBadgePlatinum} alt="" />
        )}

        {!progress.isPlatinum && progress.total > 0 && (
          <span
            className="ps5-card__platinable"
            title={t("platinable", { count: progress.total })}
          >
            <img src={TierBadgePlatinum} alt="" />
          </span>
        )}

        {!isReady && (
          <div className="ps5-card__pill">
            <Icon name="download" size={12} />
            <span>
              {isDownloading ? t("downloading") : t("not_installed")}
            </span>
          </div>
        )}

        {isReady &&
          game.achievementSupport &&
          SUPPORT_BADGES_SHOWN.has(game.achievementSupport) && (
          <div className="ps5-card__support">
            <AchievementSupportBadge
              support={game.achievementSupport}
              variant="dot"
              size={14}
            />
          </div>
        )}

        {progress.total > 0 && (
          <div className="ps5-card__progress">
            <span
              style={{ width: `${progress.percent}%` }}
              className={cn({
                "ps5-card__progress--platinum": progress.isPlatinum,
              })}
            />
          </div>
        )}
      </div>

      <div className="ps5-card__text">
        <span className="ps5-card__name">{game.title}</span>
        <span className="ps5-card__sub">{subtitle}</span>
      </div>
    </button>
  );
});
