import { useLocation } from "react-router-dom";
import { normalizeBigPicturePathname } from "../navigation";
import "./styles.scss";

type Key = "a" | "b" | "x" | "y" | "lbrb" | "ltrt" | "start";

interface Hint {
  key: Key;
  label: string;
}

const KEY_LABEL: Record<Key, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  lbrb: "LB RB",
  ltrt: "LT RT",
  start: "≡",
};

const hintsFor = (pathname: string): Hint[] => {
  const path = normalizeBigPicturePathname(pathname);
  if (path === "/") {
    return [
      { key: "a", label: "Play" },
      { key: "x", label: "Game page" },
      { key: "y", label: "Search" },
      { key: "lbrb", label: "Sections" },
      { key: "start", label: "Quick menu" },
    ];
  }
  if (path.startsWith("/library")) {
    return [
      { key: "a", label: "Open" },
      { key: "x", label: "Game menu" },
      { key: "y", label: "Search" },
      { key: "ltrt", label: "Console" },
      { key: "lbrb", label: "Sections" },
      { key: "start", label: "Quick menu" },
    ];
  }
  if (path.startsWith("/game/")) {
    return [
      { key: "a", label: "Select" },
      { key: "b", label: "Back" },
      { key: "lbrb", label: "Sections" },
      { key: "start", label: "Quick menu" },
    ];
  }
  return [
    { key: "a", label: "Select" },
    { key: "b", label: "Back" },
    { key: "lbrb", label: "Sections" },
    { key: "start", label: "Quick menu" },
  ];
};

/** Bottom bar telling which controller button does what on the current screen. */
export function ButtonHints() {
  const { pathname } = useLocation();
  return (
    <footer className="button-hints" aria-label="Controls">
      {hintsFor(pathname).map((hint) => (
        <span key={hint.key + hint.label} className="button-hints__hint">
          <i className={`opus-key opus-key--${hint.key}`}>{KEY_LABEL[hint.key]}</i>
          {hint.label}
        </span>
      ))}
    </footer>
  );
}
