import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { logger } from "@renderer/logger";
import { setFriendRequestCount } from "@renderer/features/user-details-slice";
import type {
  NotificationCountResponse,
  NotificationsChangedDetail,
  ProfileFriends,
  UserFriend,
} from "@types";
import { useUserDetails } from "./use-user-details";

/**
 * Unread notifications (local + server) and online friends, kept live through the same IPC
 * events the old sidebar profile listened to. Mount it once (Control Center) — every instance
 * polls the server on its own.
 */
export function useSocialCounts() {
  const dispatch = useDispatch();
  const { userDetails } = useUserDetails();

  const [notificationCount, setNotificationCount] = useState(0);
  const [onlineFriendsCount, setOnlineFriendsCount] = useState(0);
  const [onlineFriends, setOnlineFriends] = useState<UserFriend[]>([]);

  const apiNotificationCountRef = useRef(0);
  const hasFetchedInitialCount = useRef(false);

  const fetchLocalNotificationCount = useCallback(async () => {
    try {
      const localCount = await window.electron.getLocalNotificationsCount();
      setNotificationCount(localCount + apiNotificationCountRef.current);
    } catch (error) {
      logger.error("Failed to fetch local notification count", error);
    }
  }, []);

  const fetchApiNotificationCount = useCallback(async () => {
    try {
      const response =
        await window.electron.hydraApi.get<NotificationCountResponse>(
          "/profile/notifications/count",
          { needsAuth: true }
        );
      apiNotificationCountRef.current = response.count;
    } catch {
      // Ignore API errors
    }

    fetchLocalNotificationCount();
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    fetchLocalNotificationCount();
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    if (userDetails && !hasFetchedInitialCount.current) {
      hasFetchedInitialCount.current = true;
      fetchApiNotificationCount();
    } else if (!userDetails) {
      hasFetchedInitialCount.current = false;
      apiNotificationCountRef.current = 0;
      fetchLocalNotificationCount();
    }
  }, [userDetails, fetchApiNotificationCount, fetchLocalNotificationCount]);

  useEffect(() => {
    const unsubscribe = window.electron.onLocalNotificationCreated(() => {
      fetchLocalNotificationCount();
    });

    return () => unsubscribe();
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    const handleNotificationsChange = (event: Event) => {
      const detail = (event as CustomEvent<NotificationsChangedDetail>).detail;

      if (detail?.resetApiUnread) {
        apiNotificationCountRef.current = 0;
      } else if (typeof detail?.apiUnreadDelta === "number") {
        apiNotificationCountRef.current = Math.max(
          0,
          apiNotificationCountRef.current + detail.apiUnreadDelta
        );
      }

      fetchLocalNotificationCount();
    };

    window.addEventListener("notificationsChanged", handleNotificationsChange);
    return () => {
      window.removeEventListener(
        "notificationsChanged",
        handleNotificationsChange
      );
    };
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    const unsubscribe = window.electron.onSyncNotificationCount(
      (notification) => {
        apiNotificationCountRef.current = notification.notificationCount;
        fetchLocalNotificationCount();
      }
    );

    return () => unsubscribe();
  }, [fetchLocalNotificationCount]);

  const updateOnlineFriends = useCallback(async () => {
    if (!userDetails) {
      setOnlineFriendsCount(0);
      setOnlineFriends([]);
      return;
    }

    try {
      const response = await window.electron.hydraApi.get<ProfileFriends>(
        "/profile/friends",
        { params: { take: 20, skip: 0 } }
      );
      setOnlineFriendsCount(response.onlineFriends);
      setOnlineFriends(response.friends.filter((friend) => friend.isOnline));
    } catch {
      // ignore transient errors
    }
  }, [userDetails]);

  useEffect(() => {
    updateOnlineFriends();

    const unsubscribeFriends = window.electron.onFriendsUpdated(() => {
      updateOnlineFriends();
    });

    let interval: ReturnType<typeof setInterval> | null = null;
    const unsubscribePresence =
      typeof window.electron.onFriendPresence === "function"
        ? window.electron.onFriendPresence(() => {
            updateOnlineFriends();
          })
        : () => {
            if (interval) clearInterval(interval);
          };

    if (typeof window.electron.onFriendPresence !== "function") {
      interval = setInterval(updateOnlineFriends, 30_000);
    }

    return () => {
      unsubscribeFriends();
      unsubscribePresence();
    };
  }, [updateOnlineFriends]);

  useEffect(() => {
    const unsubscribe = window.electron.onSyncFriendRequests((result) => {
      dispatch(setFriendRequestCount(result.friendRequestCount));
    });

    return () => unsubscribe();
  }, [dispatch]);

  return { notificationCount, onlineFriendsCount, onlineFriends };
}
