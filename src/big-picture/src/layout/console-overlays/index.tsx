import type { LibraryGame } from "@types";
import { PlatformBadge } from "@renderer/components/platform-badge/platform-badge";
import { getHeroArt } from "@renderer/helpers/ps5-game";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  FocusItem,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../components";
import { IS_BROWSER } from "../../constants";
import { tr } from "../../helpers/opus-text";
import {
  useBigPictureRunningGames,
  useLibrary,
  useNavigationScreenActions,
  useUserPreferences,
} from "../../hooks";
import "./styles.scss";

const appIconUrl = new URL("../../assets/app-icon.svg", import.meta.url).href;
const INTRO_MS = 2200;
const IDLE_MS = 5 * 60_000;
// Test hook: localStorage "opus:bp-idle-ms" shortens the wait.
const getIdleMs = () => {
  try {
    return (
      Number(globalThis.localStorage.getItem("opus:bp-idle-ms")) || IDLE_MS
    );
  } catch {
    return IDLE_MS;
  }
};
const SLIDE_MS = 9_000;
const MAX_SLIDES = 14;
const SCREENSAVER_ITEM_ID = "screensaver-wake";
const SCREENSAVER_REGION_ID = "screensaver";

/** A soft rising chord, made on the fly (no audio file): the "console is on" sound. */
function playBootChime() {
  try {
    const context = new AudioContext();
    const start = context.currentTime + 0.05;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.18, start + 0.12);
    master.gain.exponentialRampToValueAtTime(0.0001, start + 2.2);
    master.connect(context.destination);

    [261.63, 392, 523.25, 659.25].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const noteStart = start + index * 0.11;
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.5, noteStart + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 1.8);
      oscillator.connect(gain).connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 2);
    });

    globalThis.setTimeout(() => void context.close(), 2600);
  } catch {
    // No audio device: the intro still plays, silently.
  }
}

/** Opening animation each time Big Picture opens: the Opus mark, a glow and a short chime. */
function BootIntro({ withSound }: Readonly<{ withSound: boolean }>) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (withSound) playBootChime();
    const timer = globalThis.setTimeout(() => setVisible(false), INTRO_MS);
    return () => globalThis.clearTimeout(timer);
    // Only once, when Big Picture opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="opus-intro"
          aria-hidden="true"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <motion.div
            className="opus-intro__glow"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
          <motion.img
            src={appIconUrl}
            alt=""
            className="opus-intro__mark"
            initial={{ opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.span
            className="opus-intro__word"
            initial={{ opacity: 0, y: 14, letterSpacing: "0.5em" }}
            animate={{ opacity: 1, y: 0, letterSpacing: "0.32em" }}
            transition={{ duration: 0.9, delay: 0.35, ease: "easeOut" }}
          >
            OPUS
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const capitalizeFirst = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const byRecent = (a: LibraryGame, b: LibraryGame) => {
  const playedA = a.lastTimePlayed ? new Date(a.lastTimePlayed).getTime() : 0;
  const playedB = b.lastTimePlayed ? new Date(b.lastTimePlayed).getTime() : 0;
  return playedB - playedA;
};

/** Watches keyboard, mouse and controller; `onIdle` after the idle time without any of them. */
function useIdle(enabled: boolean, onIdle: () => void, onActive: () => void) {
  const lastActivityRef = useRef(Date.now());
  const callbacksRef = useRef({ onIdle, onActive });
  callbacksRef.current = { onIdle, onActive };

  useEffect(() => {
    if (!enabled) return;

    const markActive = () => {
      lastActivityRef.current = Date.now();
      callbacksRef.current.onActive();
    };
    const events = ["keydown", "mousemove", "mousedown", "wheel"] as const;
    events.forEach((name) => globalThis.addEventListener(name, markActive));

    const idleMs = getIdleMs();
    const timer = globalThis.setInterval(() => {
      const pads = navigator.getGamepads?.() ?? [];
      const padActive = pads.some(
        (pad) =>
          pad &&
          (pad.buttons.some((button) => button.pressed) ||
            pad.axes.some((axis) => Math.abs(axis) > 0.35))
      );
      if (padActive) {
        markActive();
        return;
      }
      if (Date.now() - lastActivityRef.current >= idleMs) {
        callbacksRef.current.onIdle();
      }
    }, 400);

    return () => {
      events.forEach((name) =>
        globalThis.removeEventListener(name, markActive)
      );
      globalThis.clearInterval(timer);
    };
  }, [enabled]);

  return useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);
}

/** PS5-style rest screen: the art of your games drifting slowly, the clock, any button wakes. */
function Screensaver() {
  const [active, setActive] = useState(false);
  const [slide, setSlide] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const { library } = useLibrary();
  const running = Object.keys(useBigPictureRunningGames()).length > 0;

  const slides = useMemo(
    () =>
      library
        .filter((game) => !game.isDeleted)
        .sort(byRecent)
        .map((game) => ({ game, art: getHeroArt(game) }))
        .filter((entry): entry is { game: LibraryGame; art: string } =>
          Boolean(entry.art)
        )
        .slice(0, MAX_SLIDES),
    [library]
  );

  const hide = useCallback(() => setActive(false), []);
  // Never while a game is running (the controller is busy in the game) or with nothing to show.
  const markActive = useIdle(
    !running && slides.length > 0,
    () => {
      if (document.visibilityState === "visible") setActive(true);
    },
    hide
  );
  // Waking through a button also restarts the idle clock (a quick tap can fall between polls).
  const wake = useCallback(() => {
    markActive();
    hide();
  }, [hide, markActive]);

  useEffect(() => {
    if (!active) return;
    setSlide(Math.floor(Math.random() * slides.length));
    const slideTimer = globalThis.setInterval(
      () => setSlide((current) => (current + 1) % slides.length),
      SLIDE_MS
    );
    const clockTimer = globalThis.setInterval(() => setNow(new Date()), 15_000);
    setNow(new Date());
    return () => {
      globalThis.clearInterval(slideTimer);
      globalThis.clearInterval(clockTimer);
    };
  }, [active, slides.length]);

  // While it shows, every button only wakes the screen (nothing underneath reacts).
  const screenActions = useMemo(
    () =>
      active
        ? {
            press: { b: wake, x: wake, y: wake, start: wake, select: wake },
            direction: { up: wake, down: wake, left: wake, right: wake },
          }
        : {},
    [active, wake]
  );
  useNavigationScreenActions(screenActions);

  if (!IS_BROWSER) return null;
  const current = slides[slide % Math.max(1, slides.length)];
  const target = document.getElementById("big-picture") ?? document.body;

  return createPortal(
    <AnimatePresence>
      {active && current && (
        <motion.div
          className="opus-rest"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          onClick={wake}
        >
          <NavigationLayer
            rootRegionId={SCREENSAVER_REGION_ID}
            initialFocusId={SCREENSAVER_ITEM_ID}
            restoreFocusOnUnmount
          >
            <VerticalFocusGroup regionId={SCREENSAVER_REGION_ID}>
              <FocusItem
                id={SCREENSAVER_ITEM_ID}
                actions={{ primary: wake }}
                asChild
              >
                <button
                  type="button"
                  className="opus-rest__wake"
                  aria-label={tr("Wake up", "Voltar")}
                  onClick={wake}
                />
              </FocusItem>
            </VerticalFocusGroup>
          </NavigationLayer>

          <AnimatePresence>
            <motion.img
              key={current.art}
              src={current.art}
              alt=""
              className="opus-rest__art"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.6 }}
            />
          </AnimatePresence>
          <div className="opus-rest__shade" />

          <div className="opus-rest__clock">
            <span className="opus-rest__time">
              {now.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="opus-rest__date">
              {capitalizeFirst(
                now.toLocaleDateString([], {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              )}
            </span>
          </div>

          <div className="opus-rest__game">
            <PlatformBadge game={current.game} className="opus-rest__badge" />
            <span className="opus-rest__title">{current.game.title}</span>
          </div>

          <span className="opus-rest__hint">
            {tr("Press any button", "Pressione qualquer botão")}
          </span>
        </motion.div>
      )}
    </AnimatePresence>,
    target
  );
}

/** The two "console" moments that only Big Picture has: the opening and the rest screen. */
export function ConsoleOverlays() {
  const userPreferences = useUserPreferences();
  const withSound = userPreferences?.bigPictureSoundsEnabled ?? true;

  return (
    <>
      <BootIntro withSound={withSound} />
      <Screensaver />
    </>
  );
}
