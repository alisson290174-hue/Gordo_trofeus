import { SignOutIcon, UserIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthPage } from "@shared";
import { FocusItem, HorizontalFocusGroup } from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useGamepad, useUserDetails } from "../../hooks";
import { NavigationAudioService, NavigationService, type FocusOverrides } from "../../services";
import {
  useNavigationStore,
  useVirtualKeyboardStore,
} from "../../stores";
import { GamepadButtonType } from "../../types";
import {
  BIG_PICTURE_APP_LAYER_ID,
  getBigPictureContentRouteEntryTargetFromPathname,
  normalizeBigPicturePathname,
} from "../navigation";
import "./styles.scss";

const BASE_PATH = IS_DESKTOP ? "/big-picture" : "";
const AppIcon = new URL("../../assets/app-icon.svg", import.meta.url).href;

export const TOP_NAV_REGION_ID = "top-nav";
export const TOP_NAV_EXIT_ID = "top-nav-exit";
export const TOP_NAV_PROFILE_ID = "top-nav-profile";
export const getTopNavSectionId = (key: string) => `top-nav-section-${key}`;

interface Section {
  key: string;
  label: string;
  path: string;
  matches: (pathname: string) => boolean;
}

const useClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(new Date()), 15_000);
    return () => globalThis.clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/**
 * PS5-style top bar: the sections sit in one row and LB / RB move between them from anywhere on
 * the screen (pages with their own tabs use LT / RT). Replaces the old left sidebar.
 */
export function TopNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const normalized = normalizeBigPicturePathname(pathname);
  const { userDetails } = useUserDetails();
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const keyboardOpen = useVirtualKeyboardStore((state) => state.target !== null);
  const clock = useClock();

  const sections = useMemo<Section[]>(
    () => [
      { key: "home", label: "Home", path: BASE_PATH || "/", matches: (p) => p === "/" },
      { key: "library", label: "Library", path: `${BASE_PATH}/library`, matches: (p) => p.startsWith("/library") || p.startsWith("/game/") },
      {
        key: "trophies",
        label: "Trophies",
        path: userDetails?.id ? `${BASE_PATH}/profile/${userDetails.id}` : `${BASE_PATH}/profile`,
        matches: (p) => p.startsWith("/profile"),
      },
      { key: "downloads", label: "Downloads", path: `${BASE_PATH}/downloads`, matches: (p) => p.startsWith("/downloads") },
      { key: "catalogue", label: "Catalogue", path: `${BASE_PATH}/catalogue`, matches: (p) => p.startsWith("/catalogue") },
      { key: "settings", label: "Settings", path: `${BASE_PATH}/settings`, matches: (p) => p.startsWith("/settings") },
    ],
    [userDetails?.id]
  );

  const activeIndex = Math.max(
    0,
    sections.findIndex((section) => section.matches(normalized))
  );

  // Coming up from a page lands on the current section, not on the last button of the bar.
  const activeSectionKey = sections[activeIndex]?.key;
  useEffect(() => {
    if (!activeSectionKey) return;
    NavigationService.getInstance().rememberFocusInRegion(
      TOP_NAV_REGION_ID,
      getTopNavSectionId(activeSectionKey)
    );
  }, [activeSectionKey]);

  const goTo = useCallback(
    (index: number) => {
      const section = sections[index];
      if (!section) return;
      NavigationAudioService.getInstance().play("scroll");
      navigate(section.path);
    },
    [navigate, sections]
  );

  // LB / RB: only on the main layer (never under a modal, a menu or the on-screen keyboard).
  useEffect(() => {
    const canSwitch = () => {
      if (keyboardOpen) return false;
      const { currentFocusId, nodes } = useNavigationStore.getState();
      const focused = nodes.find((node) => node.id === currentFocusId);
      return !focused || focused.layerId === BIG_PICTURE_APP_LAYER_ID;
    };
    const removePrevious = onButtonPressed(GamepadButtonType.LEFT_BUMPER, (event) => {
      if (!isActiveGamepadEvent(event) || !canSwitch()) return;
      goTo((activeIndex - 1 + sections.length) % sections.length);
    });
    const removeNext = onButtonPressed(GamepadButtonType.RIGHT_BUMPER, (event) => {
      if (!isActiveGamepadEvent(event) || !canSwitch()) return;
      goTo((activeIndex + 1) % sections.length);
    });
    return () => {
      removePrevious();
      removeNext();
    };
  }, [activeIndex, goTo, isActiveGamepadEvent, keyboardOpen, onButtonPressed, sections.length]);

  const handleExit = useCallback(() => {
    if (IS_DESKTOP) {
      globalThis.close();
      return;
    }
    navigate("/");
  }, [navigate]);

  const handleProfile = useCallback(() => {
    if (!userDetails?.id) {
      if (IS_DESKTOP) void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    navigate(`${BASE_PATH}/profile/${userDetails.id}`);
  }, [navigate, userDetails?.id]);

  const down = getBigPictureContentRouteEntryTargetFromPathname(pathname);
  const overrides = (left?: string, right?: string): FocusOverrides => ({
    up: { type: "block" },
    down,
    left: left ? { type: "item", itemId: left } : { type: "block" },
    right: right ? { type: "item", itemId: right } : { type: "block" },
  });

  return (
    <header className={cn("top-nav", { "top-nav--solid": normalized !== "/" })}>
      <div className="top-nav__brand">
        <img src={AppIcon} alt="" className="top-nav__logo" />
        <span>Opus</span>
      </div>

      <HorizontalFocusGroup
        regionId={TOP_NAV_REGION_ID}
        className="top-nav__sections"
        aria-label="Sections"
      >
        <span className="top-nav__bumper" aria-hidden="true">LB</span>
        {sections.map((section, index) => {
          const id = getTopNavSectionId(section.key);
          const previous = sections[index - 1];
          const next = sections[index + 1];
          return (
            <FocusItem
              key={section.key}
              id={id}
              actions={{ primary: () => navigate(section.path) }}
              navigationOverrides={overrides(
                previous ? getTopNavSectionId(previous.key) : undefined,
                next ? getTopNavSectionId(next.key) : TOP_NAV_PROFILE_ID
              )}
              asChild
            >
              <button
                type="button"
                className={cn("top-nav__section", {
                  "top-nav__section--active": index === activeIndex,
                })}
                onClick={() => navigate(section.path)}
              >
                {section.label}
              </button>
            </FocusItem>
          );
        })}
        <span className="top-nav__bumper" aria-hidden="true">RB</span>

        <div className="top-nav__status">
          <span className="top-nav__clock">{clock}</span>
          <FocusItem
            id={TOP_NAV_PROFILE_ID}
            actions={{ primary: handleProfile }}
            navigationOverrides={overrides(
              getTopNavSectionId(sections[sections.length - 1].key),
              TOP_NAV_EXIT_ID
            )}
            asChild
          >
            <button
              type="button"
              className="top-nav__avatar"
              aria-label={userDetails?.displayName ?? "Sign in"}
              onClick={handleProfile}
            >
              {userDetails?.profileImageUrl ? (
                <img src={userDetails.profileImageUrl} alt="" />
              ) : (
                <UserIcon size={26} />
              )}
            </button>
          </FocusItem>
          <FocusItem
            id={TOP_NAV_EXIT_ID}
            actions={{ primary: handleExit }}
            navigationOverrides={overrides(TOP_NAV_PROFILE_ID)}
            asChild
          >
            <button
              type="button"
              className="top-nav__exit"
              aria-label="Exit Big Picture"
              onClick={handleExit}
            >
              <SignOutIcon size={26} />
            </button>
          </FocusItem>
        </div>
      </HorizontalFocusGroup>
    </header>
  );
}
