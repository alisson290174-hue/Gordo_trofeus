import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Backdrop, FocusItem, NavigationLayer, VerticalFocusGroup } from "../../components";
import { IS_BROWSER, IS_DESKTOP } from "../../constants";
import type { LibraryGame } from "@types";
import { getTileArt } from "@renderer/helpers/ps5-game";
import {
  useBigPictureRunningGames,
  useLibrary,
  useNavigationScreenActions,
} from "../../hooks";
import { NavigationAudioService } from "../../services";
import { useNavigationStore, useVirtualKeyboardStore } from "../../stores";
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
  const { library } = useLibrary();
  // Running games arrive as "shop:objectId"; title and art come from the library.
  const current = useMemo(() => {
    const first = running[0];
    if (!first) return null;
    const separator = first.id.indexOf(":");
    const shop = (first.shop ?? first.id.slice(0, separator)) as LibraryGame["shop"];
    const objectId = first.objectId ?? first.id.slice(separator + 1);
    const game = library.find((entry) => entry.shop === shop && entry.objectId === objectId);
    return {
      shop,
      objectId,
      title: first.title ?? game?.title ?? "",
      art: game ? getTileArt(game)?.url ?? null : null,
      sessionDurationInMillis: first.sessionDurationInMillis,
    };
  }, [library, running]);
  const keyboardOpen = useVirtualKeyboardStore((state) => state.target !== null);

  const close = useCallback(() => setOpen(false), []);

  // Start toggles the menu through Big Picture's screen actions (same path as every other screen
  // button); only from the main screen, never under a modal or the on-screen keyboard.
  const toggle = useCallback(() => {
    if (keyboardOpen) return;
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      const { currentFocusId, nodes } = useNavigationStore.getState();
      const focused = nodes.find((node) => node.id === currentFocusId);
      if (focused && focused.layerId !== BIG_PICTURE_APP_LAYER_ID) return false;
      NavigationAudioService.getInstance().play("select");
      return true;
    });
  }, [keyboardOpen]);

  const screenActions = useMemo(
    () => ({ press: open ? { start: toggle, b: close } : { start: toggle } }),
    [close, open, toggle]
  );

  useNavigationScreenActions(screenActions);

  const actions = useMemo<QuickAction[]>(() => {
    const list: QuickAction[] = [];
    if (current) {
      list.push({
        label: "Close game",
        meta: "saves and quits",
        run: () => {
          if (IS_DESKTOP) void globalThis.window.electron.closeGame(current.shop, current.objectId);
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
                  {current.art ? (
                    <img src={current.art} alt="" />
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
