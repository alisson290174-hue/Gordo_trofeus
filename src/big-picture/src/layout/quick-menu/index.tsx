import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Backdrop, FocusItem, NavigationLayer, VerticalFocusGroup } from "../../components";
import { IS_BROWSER, IS_DESKTOP } from "../../constants";
import { useBigPictureRunningGames, useGamepad, useNavigationScreenActions } from "../../hooks";
import { NavigationAudioService } from "../../services";
import { useNavigationStore, useVirtualKeyboardStore } from "../../stores";
import { GamepadButtonType } from "../../types";
import { BIG_PICTURE_APP_LAYER_ID } from "../navigation";
import "./styles.scss";

const QUICK_MENU_REGION_ID = "quick-menu";
const QUICK_MENU_FIRST_ID = "quick-menu-item-0";
const BASE_PATH = IS_DESKTOP ? "/big-picture" : "";

const formatSession = (millis: number) => {
  const minutes = Math.max(1, Math.round(millis / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};

interface QuickAction {
  label: string;
  meta?: string;
  run: () => void;
}

/**
 * Side menu opened with Start (≡) from anywhere: back to the game, close it, friends, settings,
 * leave Big Picture. B or Start again closes it.
 */
export function QuickMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const running = Object.values(useBigPictureRunningGames());
  const current = running[0] ?? null;
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const keyboardOpen = useVirtualKeyboardStore((state) => state.target !== null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    return onButtonPressed(GamepadButtonType.START, (event) => {
      if (!isActiveGamepadEvent(event) || keyboardOpen) return;
      setOpen((wasOpen) => {
        if (wasOpen) return false;
        // Only from the main screen: modals keep Start for themselves.
        const { currentFocusId, nodes } = useNavigationStore.getState();
        const focused = nodes.find((node) => node.id === currentFocusId);
        if (focused && focused.layerId !== BIG_PICTURE_APP_LAYER_ID) return false;
        NavigationAudioService.getInstance().play("select");
        return true;
      });
    });
  }, [isActiveGamepadEvent, keyboardOpen, onButtonPressed]);

  useNavigationScreenActions(open ? { press: { b: close } } : {});

  const actions = useMemo<QuickAction[]>(() => {
    const list: QuickAction[] = [];
    if (current?.shop && current.objectId) {
      list.push({
        label: "Close game",
        meta: "saves and quits",
        run: () => {
          if (IS_DESKTOP) void globalThis.window.electron.closeGame(current.shop!, current.objectId!);
        },
      });
    }
    list.push(
      { label: "Friends", run: () => IS_DESKTOP && void globalThis.window.electron.openFriendsWindow() },
      { label: "Library", run: () => navigate(`${BASE_PATH}/library`) },
      { label: "Settings", run: () => navigate(`${BASE_PATH}/settings`) },
      {
        label: "Exit Big Picture",
        meta: "back to the desktop",
        run: () => (IS_DESKTOP ? globalThis.close() : navigate("/")),
      }
    );
    return list;
  }, [current, navigate]);

  if (!IS_BROWSER) return null;
  const target = document.getElementById("big-picture") ?? document.body;

  return createPortal(
    <AnimatePresence>
      {open && (
        <Backdrop className="quick-menu__backdrop">
          <motion.aside
            className="quick-menu"
            aria-label="Quick menu"
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <NavigationLayer rootRegionId={QUICK_MENU_REGION_ID} initialFocusId={QUICK_MENU_FIRST_ID}>
              {current ? (
                <div className="quick-menu__now">
                  {current.coverImageUrl || current.iconUrl ? (
                    <img src={current.customIconUrl ?? current.iconUrl ?? current.coverImageUrl ?? ""} alt="" />
                  ) : (
                    <span className="quick-menu__now-art" />
                  )}
                  <div className="quick-menu__now-text">
                    <span className="quick-menu__eyebrow">Playing now</span>
                    <span className="quick-menu__now-title">{current.title}</span>
                    <span className="quick-menu__meta">{formatSession(current.sessionDurationInMillis)}</span>
                  </div>
                </div>
              ) : (
                <span className="quick-menu__eyebrow">Quick menu</span>
              )}

              <VerticalFocusGroup regionId={QUICK_MENU_REGION_ID} className="quick-menu__actions">
                {actions.map((action, index) => (
                  <FocusItem
                    key={action.label}
                    id={`quick-menu-item-${index}`}
                    actions={{
                      primary: () => {
                        close();
                        action.run();
                      },
                    }}
                    asChild
                  >
                    <button
                      type="button"
                      className="quick-menu__action"
                      onClick={() => {
                        close();
                        action.run();
                      }}
                    >
                      <span>{action.label}</span>
                      {action.meta && <span className="quick-menu__meta">{action.meta}</span>}
                    </button>
                  </FocusItem>
                ))}
              </VerticalFocusGroup>

              <div className="quick-menu__hints">
                <span><i className="opus-key opus-key--a">A</i>Select</span>
                <span><i className="opus-key opus-key--b">B</i>Close menu</span>
              </div>
            </NavigationLayer>
          </motion.aside>
        </Backdrop>
      )}
    </AnimatePresence>,
    target
  );
}
