import { useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "@renderer/components/icon/icon";
import { useTranslation } from "react-i18next";
import { useDate, useFormat } from "@renderer/hooks";
import { gameDetailsContext } from "@renderer/context";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";

import { Tooltip } from "react-tooltip";
import "./hero-panel-playtime.scss";

export function HeroPanelPlaytime() {
  const [lastTimePlayed, setLastTimePlayed] = useState("");

  const { game, isGameRunning } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");
  const { numberFormatter } = useFormat();
  const { formatDistance } = useDate();
  useEffect(() => {
    if (game?.lastTimePlayed) {
      setLastTimePlayed(
        formatDistance(game.lastTimePlayed, new Date(), {
          addSuffix: true,
        })
      );
    }
  }, [game?.lastTimePlayed, formatDistance]);

  const formattedPlayTime = useMemo(() => {
    const milliseconds = getDisplayedPlayTimeInMilliseconds({
      playTimeInMilliseconds: game?.playTimeInMilliseconds || 0,
      steamPlayTimeInMilliseconds: game?.steamPlayTimeInMilliseconds,
    });
    const seconds = milliseconds / 1000;
    const minutes = seconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  }, [
    game?.playTimeInMilliseconds,
    game?.steamPlayTimeInMilliseconds,
    numberFormatter,
    t,
  ]);

  if (!game) return null;

  const displayedPlayTimeInMilliseconds = getDisplayedPlayTimeInMilliseconds({
    playTimeInMilliseconds: game.playTimeInMilliseconds || 0,
    steamPlayTimeInMilliseconds: game.steamPlayTimeInMilliseconds,
  });

  if (!game.lastTimePlayed && displayedPlayTimeInMilliseconds <= 0) {
    return (
      <>
        <p>{t("not_played_yet", { title: game?.title })}</p>
      </>
    );
  }

  if (isGameRunning) {
    return (
      <>
        <p>{t("playing_now")}</p>
      </>
    );
  }

  return (
    <>
      <p
        className="hero-panel-playtime__play-time"
        data-tooltip-place="right"
        data-tooltip-content={
          game.hasManuallyUpdatedPlaytime
            ? t("manual_playtime_tooltip")
            : undefined
        }
        data-tooltip-id={
          game.hasManuallyUpdatedPlaytime
            ? "manual-playtime-warning"
            : undefined
        }
      >
        {game.hasManuallyUpdatedPlaytime && (
          <Icon
            name="alert-fill"
            size={16}
            className="hero-panel-playtime__manual-warning"
          />
        )}
        {t("play_time", {
          amount: formattedPlayTime,
        })}
      </p>

      <p>
        {t("last_time_played", {
          period: lastTimePlayed,
        })}
      </p>

      {game.hasManuallyUpdatedPlaytime && (
        <Tooltip
          id="manual-playtime-warning"
          style={{
            zIndex: 9999,
          }}
          openOnClick={false}
        />
      )}
    </>
  );
}
