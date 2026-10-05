import type { ProfileFriends, UserFriend } from "@types";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Backdrop,
  FocusItem,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../components";
import { IS_BROWSER, IS_DESKTOP } from "../../constants";
import { tr } from "../../helpers/opus-text";
import { useNavigationScreenActions } from "../../hooks";
import { NavigationAudioService, NavigationService } from "../../services";
import "./styles.scss";

const OPEN_EVENT = "opus:open-friends-panel";
const REGION_ID = "friends-panel";
const PAGE_SIZE = 50;
const BASE_PATH = IS_DESKTOP ? "/big-picture" : "";

/** Opens the Big Picture friends panel (used by the quick menu). */
export const openFriendsPanel = (returnFocusId: string | null = null) =>
  globalThis.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: returnFocusId })
  );

const formatSession = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};

const statusOf = (friend: UserFriend) => {
  if (friend.currentGame) {
    return tr(
      `Playing ${friend.currentGame.title} · ${formatSession(friend.currentGame.sessionDurationInSeconds)}`,
      `Jogando ${friend.currentGame.title} · ${formatSession(friend.currentGame.sessionDurationInSeconds)}`
    );
  }
  return friend.isOnline ? "Online" : "Offline";
};

/**
 * Friends inside Big Picture (side panel, controller only) instead of the separate desktop
 * window, which stole the focus and brought the Windows taskbar over the fullscreen view.
 */
export function FriendsPanel() {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<UserFriend[] | null>(null);
  const returnFocusIdRef = useRef<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!IS_DESKTOP) return;
    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ProfileFriends>(
          "/profile/friends",
          { params: { take: PAGE_SIZE, skip: 0 } }
        );
      setFriends(response.friends);
    } catch {
      setFriends((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      returnFocusIdRef.current =
        (event as CustomEvent<string | null>).detail ??
        NavigationService.getInstance().getCurrentFocusId();
      NavigationAudioService.getInstance().play("select");
      setOpen(true);
      void load();
    };
    globalThis.addEventListener(OPEN_EVENT, onOpen);
    return () => globalThis.removeEventListener(OPEN_EVENT, onOpen);
  }, [load]);

  // Presence changes while the panel is open.
  useEffect(() => {
    if (!open || !IS_DESKTOP) return;
    const electron = globalThis.window.electron;
    const unsubscribeFriends = electron.onFriendsUpdated(() => void load());
    const unsubscribePresence =
      typeof electron.onFriendPresence === "function"
        ? electron.onFriendPresence(({ friendId, isOnline }) =>
            setFriends((current) =>
              current
                ? current.map((friend) =>
                    friend.id === friendId ? { ...friend, isOnline } : friend
                  )
                : current
            )
          )
        : () => {};
    return () => {
      unsubscribeFriends();
      unsubscribePresence();
    };
  }, [load, open]);

  const close = useCallback(() => {
    NavigationAudioService.getInstance().play("back");
    setOpen(false);
    // Back to the item that was selected before the menus opened.
    const returnFocusId = returnFocusIdRef.current;
    if (returnFocusId)
      globalThis.setTimeout(
        () =>
          NavigationService.getInstance().requestFocusWhenAvailable(
            returnFocusId
          ),
        300
      );
  }, []);

  useNavigationScreenActions(
    useMemo(
      () => (open ? { press: { b: close, start: close } } : {}),
      [close, open]
    )
  );

  const sorted = useMemo(
    () =>
      [...(friends ?? [])].sort(
        (a, b) =>
          Number(Boolean(b.currentGame)) - Number(Boolean(a.currentGame)) ||
          Number(Boolean(b.isOnline)) - Number(Boolean(a.isOnline)) ||
          a.displayName.localeCompare(b.displayName)
      ),
    [friends]
  );
  const onlineCount = sorted.filter((friend) => friend.isOnline).length;

  if (!IS_BROWSER) return null;
  const target = document.getElementById("big-picture") ?? document.body;
  const firstId = sorted[0]
    ? `friends-panel-${sorted[0].id}`
    : "friends-panel-empty";

  return createPortal(
    <AnimatePresence>
      {open && (
        <Backdrop className="friends-panel__backdrop">
          <motion.aside
            className="friends-panel"
            aria-label={tr("Friends", "Amigos")}
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <NavigationLayer
              rootRegionId={REGION_ID}
              initialFocusId={firstId}
              restoreFocusOnUnmount
            >
              <header className="friends-panel__header">
                <span className="friends-panel__eyebrow">
                  {tr("Friends", "Amigos")}
                </span>
                <span className="friends-panel__count">
                  {friends === null
                    ? tr("Loading…", "Carregando…")
                    : tr(
                        `${onlineCount} online of ${sorted.length}`,
                        `${onlineCount} online de ${sorted.length}`
                      )}
                </span>
              </header>

              <VerticalFocusGroup
                regionId={REGION_ID}
                className="friends-panel__list"
              >
                {friends !== null && sorted.length === 0 ? (
                  <FocusItem
                    id="friends-panel-empty"
                    actions={{ primary: close }}
                    asChild
                  >
                    <div className="friends-panel__empty">
                      {tr(
                        "No friends yet. Add friends in the desktop app.",
                        "Nenhum amigo ainda. Adicione amigos pelo app no modo normal."
                      )}
                    </div>
                  </FocusItem>
                ) : (
                  sorted.map((friend) => {
                    const openProfile = () => {
                      setOpen(false);
                      navigate(`${BASE_PATH}/profile/${friend.id}`);
                    };
                    return (
                      <FocusItem
                        key={friend.id}
                        id={`friends-panel-${friend.id}`}
                        actions={{ primary: openProfile }}
                        asChild
                      >
                        <button
                          type="button"
                          className="friends-panel__friend"
                          onClick={openProfile}
                        >
                          <span className="friends-panel__avatar">
                            {friend.profileImageUrl ? (
                              <img src={friend.profileImageUrl} alt="" />
                            ) : (
                              <span>
                                {friend.displayName.charAt(0).toUpperCase()}
                              </span>
                            )}
                            <i
                              className={
                                friend.isOnline
                                  ? "friends-panel__dot friends-panel__dot--online"
                                  : "friends-panel__dot"
                              }
                            />
                          </span>
                          <span className="friends-panel__text">
                            <span className="friends-panel__name">
                              {friend.displayName}
                            </span>
                            <span
                              className={
                                friend.currentGame
                                  ? "friends-panel__status friends-panel__status--playing"
                                  : "friends-panel__status"
                              }
                            >
                              {statusOf(friend)}
                            </span>
                          </span>
                        </button>
                      </FocusItem>
                    );
                  })
                )}
              </VerticalFocusGroup>

              <div className="friends-panel__hints">
                <span>
                  <i className="opus-key opus-key--a">A</i>
                  {tr("Profile", "Perfil")}
                </span>
                <span>
                  <i className="opus-key opus-key--b">B</i>
                  {tr("Close", "Fechar")}
                </span>
              </div>
            </NavigationLayer>
          </motion.aside>
        </Backdrop>
      )}
    </AnimatePresence>,
    target
  );
}
