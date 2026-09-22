import { useCallback } from "react";
import { Icon } from "@renderer/components/icon/icon";

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDate } from "@renderer/hooks";
import cn from "classnames";

import type { LocalNotification } from "@types";
import "./notification-item.scss";

interface LocalNotificationItemProps {
  notification: LocalNotification;
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
}

export function LocalNotificationItem({
  notification,
  onDismiss,
  onMarkAsRead,
}: Readonly<LocalNotificationItemProps>) {
  const { t } = useTranslation("notifications_page");
  const { formatDistance } = useDate();
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }

    if (notification.url) {
      navigate(notification.url);
    }
  }, [notification, onMarkAsRead, navigate]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(notification.id);
    },
    [notification.id, onDismiss]
  );

  const getIcon = () => {
    switch (notification.type) {
      case "DOWNLOAD_COMPLETE":
        return <Icon name="download" size={24} />;
      case "EXTRACTION_COMPLETE":
        return <Icon name="package" size={24} />;
      case "UPDATE_AVAILABLE":
        return <Icon name="sync" size={24} />;
      case "ACHIEVEMENT_UNLOCKED":
        return <Icon name="trophy" size={24} />;
      case "SCAN_GAMES_COMPLETE":
        return <Icon name="sync" size={24} />;
      default:
        return <Icon name="download" size={24} />;
    }
  };

  return (
    <button
      type="button"
      className={cn("notification-item", {
        "notification-item--unread": !notification.isRead,
      })}
      onClick={handleClick}
    >
      <div className="notification-item__picture">
        {notification.pictureUrl ? (
          <img src={notification.pictureUrl} alt="" />
        ) : (
          getIcon()
        )}
      </div>

      <div className="notification-item__content">
        <span className="notification-item__title">{notification.title}</span>
        <span className="notification-item__description">
          {notification.description}
        </span>
        <span className="notification-item__time">
          <Icon name="hourglass" size={12} />
          {formatDistance(new Date(notification.createdAt), new Date())}
        </span>
      </div>

      <button
        type="button"
        className="notification-item__dismiss"
        onClick={handleDismiss}
        title={t("dismiss")}
      >
        <Icon name="x" size={16} />
      </button>
    </button>
  );
}
