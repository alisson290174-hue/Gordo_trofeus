import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@renderer/components/icon/icon";
import {
  useAppSelector,
  useSocialCounts,
  useUserDetails,
} from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import AppIcon from "@renderer/assets/icons/app-icon-refresh.png";
import "./control-center.scss";

const FRIEND_COLORS = ["#2a4a7a", "#7a4a2a", "#2a6a5a"];

/**
 * "Central de Controle" — the floating glass pill from Conceito 1 that replaces the old
 * bottom status bar: game running, friends online,
 * notifications and a clock.
 */
export function ControlCenter() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["dashboard", "sidebar"]);
  const { userDetails } = useUserDetails();
  const gameRunning = useAppSelector((state) => state.gameRunning.gameRunning);
  const { notificationCount, onlineFriendsCount, onlineFriends } =
    useSocialCounts();

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(interval);
  }, []);

  const clock = now.toLocaleTimeString(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="control-center">
      <button
        type="button"
        className="control-center__home"
        onClick={() => navigate("/")}
      >
        <img src={AppIcon} alt="" />
      </button>

      <div className="control-center__divider" />

      {gameRunning && (
        <button
          type="button"
          className="control-center__item"
          onClick={() => navigate(buildGameDetailsPath(gameRunning))}
        >
          <Icon name="play" size={16} className="control-center__playing" />
          <span className="control-center__playing-title">
            {gameRunning.title}
          </span>
        </button>
      )}

      {userDetails && (
        <button
          type="button"
          className="control-center__item"
          onClick={() => window.electron.openFriendsWindow()}
          title={t("sidebar:friends")}
        >
          {onlineFriends.length > 0 ? (
            <div className="control-center__friends">
              {onlineFriends.slice(0, 3).map((friend, index) => (
                <span
                  key={friend.id}
                  className="control-center__friend"
                  style={{ background: FRIEND_COLORS[index] }}
                >
                  {friend.profileImageUrl ? (
                    <img src={friend.profileImageUrl} alt="" />
                  ) : (
                    friend.displayName.charAt(0).toUpperCase()
                  )}
                </span>
              ))}
            </div>
          ) : (
            <Icon name="people" size={18} />
          )}
          <span className="control-center__online">
            <span className="control-center__online-dot">●</span>{" "}
            {t("dashboard:online_count", { count: onlineFriendsCount })}
          </span>
        </button>
      )}

      <button
        type="button"
        className="control-center__icon"
        onClick={() => navigate("/notifications")}
        title={t("sidebar:notifications")}
      >
        <Icon name="bell" size={20} />
        {notificationCount > 0 && (
          <span className="control-center__badge">
            {notificationCount > 99 ? "99+" : notificationCount}
          </span>
        )}
      </button>

      <div className="control-center__divider" />

      <span className="control-center__clock">{clock}</span>
    </div>
  );
}
