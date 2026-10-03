import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pickNeighbor, type Direction } from "@renderer/helpers/spatial-navigation";

/**
 * The controller works in the desktop app too (not only in Big Picture): the d-pad / left stick
 * moves focus to the nearest control in that direction, A clicks, B goes back (or closes the open
 * dialog), LB / RB switch the top sections and Start opens Big Picture. Only while this window
 * has focus; the mouse takes over again as soon as it moves.
 */

const SECTIONS = ["/", "/library", "/catalogue", "/downloads", "/trophies"];

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"]';

// Standard Gamepad mapping (Xbox layout).
const BUTTON = { a: 0, b: 1, lb: 4, rb: 5, start: 9, up: 12, down: 13, left: 14, right: 15 };
const STICK_THRESHOLD = 0.6;
const FIRST_REPEAT_MS = 380;
const REPEAT_MS = 130;

const isVisible = (element: HTMLElement) => {
  if (element.closest('[aria-hidden="true"], [inert]')) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
};

/** An open dialog keeps the focus inside it. */
const currentScope = (): ParentNode => {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], .modal')].filter(
    (dialog) => dialog.getBoundingClientRect().width > 0
  );
  return dialogs.at(-1) ?? document;
};

const focusables = (scope: ParentNode) =>
  [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible);

const setGamepadMode = (on: boolean) => document.body.classList.toggle("gamepad-nav", on);

const moveFocus = (direction: Direction) => {
  setGamepadMode(true);
  const scope = currentScope();
  const candidates = focusables(scope);
  if (candidates.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const from = active && candidates.includes(active) ? active : null;
  if (!from) {
    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    candidates[0].focus();
    return;
  }
  const others = candidates.filter((candidate) => candidate !== from);
  const index = pickNeighbor(from.getBoundingClientRect(), others.map((el) => el.getBoundingClientRect()), direction);
  const next = index >= 0 ? others[index] : null;
  if (next) {
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  } else if (direction === "down" || direction === "up") {
    // Nothing further on screen: scroll the page to bring more items in.
    (from.closest("[data-scroll-container], main, .container__content") ?? document.scrollingElement)?.scrollBy({
      top: direction === "down" ? innerHeight * 0.6 : -innerHeight * 0.6,
      behavior: "smooth",
    });
  }
};

export function useDesktopGamepad() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let frame = 0;
    const pressed = new Map<number, boolean>();
    const held: { dir: Direction | null; since: number; last: number } = { dir: null, since: 0, last: 0 };

    const onPress = (button: number) => {
      switch (button) {
        case BUTTON.a: {
          setGamepadMode(true);
          const active = document.activeElement as HTMLElement | null;
          if (active && active !== document.body) active.click();
          else moveFocus("down");
          break;
        }
        case BUTTON.b: {
          setGamepadMode(true);
          if (currentScope() !== document) {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            (document.activeElement as HTMLElement | null)?.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
            );
          } else if (pathname !== "/") navigate(-1);
          break;
        }
        case BUTTON.lb:
        case BUTTON.rb: {
          const current = Math.max(0, SECTIONS.findIndex((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path))));
          const step = button === BUTTON.rb ? 1 : -1;
          navigate(SECTIONS[(current + step + SECTIONS.length) % SECTIONS.length]);
          break;
        }
        case BUTTON.start:
          void window.electron.openBigPictureWindow();
          break;
        default:
      }
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!document.hasFocus()) return;
      const pad = [...(navigator.getGamepads?.() ?? [])].find((candidate) => candidate?.connected);
      if (!pad) return;

      for (const button of Object.values(BUTTON)) {
        const isDown = Boolean(pad.buttons[button]?.pressed);
        const wasDown = pressed.get(button) ?? false;
        pressed.set(button, isDown);
        if (isDown && !wasDown && button !== BUTTON.up && button !== BUTTON.down && button !== BUTTON.left && button !== BUTTON.right) {
          onPress(button);
        }
      }

      // Direction from the d-pad or the left stick, with key-repeat while held.
      const [x = 0, y = 0] = pad.axes;
      const dir: Direction | null = pad.buttons[BUTTON.up]?.pressed || y < -STICK_THRESHOLD
        ? "up"
        : pad.buttons[BUTTON.down]?.pressed || y > STICK_THRESHOLD
          ? "down"
          : pad.buttons[BUTTON.left]?.pressed || x < -STICK_THRESHOLD
            ? "left"
            : pad.buttons[BUTTON.right]?.pressed || x > STICK_THRESHOLD
              ? "right"
              : null;
      const now = performance.now();
      if (dir !== held.dir) {
        held.dir = dir;
        held.since = now;
        held.last = now;
        if (dir) moveFocus(dir);
      } else if (dir && now - held.since > FIRST_REPEAT_MS && now - held.last > REPEAT_MS) {
        held.last = now;
        moveFocus(dir);
      }
    };

    frame = requestAnimationFrame(tick);
    const onMouse = () => setGamepadMode(false);
    window.addEventListener("mousemove", onMouse);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMouse);
    };
  }, [navigate, pathname]);
}
