import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getPlatformBadge } from "@renderer/helpers/platform-badge";
import "@renderer/components/platform-badge/platform-badge.scss";
import { Icon } from "@renderer/components/icon/icon";
import { SteamIcon } from "@renderer/components/steam-library-badge/steam-library-badge";
import "./category-filter.scss";

import {
  LIBRARY_PAGE_CATEGORIES,
  type LibraryCategory,
} from "./library-category";
export type { LibraryCategory } from "./library-category";

export function ClassicsIcon({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="url(#classics-switch-gradient)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient
          id="classics-switch-gradient"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f8c802" />
          <stop offset="25%" stopColor="#fc5812" />
          <stop offset="50%" stopColor="#fb0026" />
          <stop offset="75%" stopColor="#c80078" />
          <stop offset="100%" stopColor="#7300a4" />
        </linearGradient>
      </defs>
      <line x1="6" x2="10" y1="11" y2="11" />
      <line x1="8" x2="8" y1="9" y2="13" />
      <line x1="15" x2="15.01" y1="12" y2="12" />
      <line x1="18" x2="18.01" y1="10" y2="10" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
    </svg>
  );
}

interface CategoryFilterProps {
  category: LibraryCategory;
  onCategoryChange: (category: LibraryCategory) => void;
  /** To list one tab per emulated console that actually has games. */
  library?: { shop: string; platform?: string | null }[];
}

export function CategoryFilter({
  category,
  onCategoryChange,
  library = [],
}: Readonly<CategoryFilterProps>) {
  const { t } = useTranslation("library");

  const icons: Partial<Record<LibraryCategory, JSX.Element>> = {
    all: <Icon name="stack" size={14} />,
    steam: <SteamIcon size={14} />,
    epic: <span className="library-category-filter__epic">E</span>,
    torrent: <Icon name="download" size={14} />,
    classics: <ClassicsIcon size={16} />,
  };

  const options = LIBRARY_PAGE_CATEGORIES.map((value) => ({
    value,
    label: t(`category_${value}`),
    icon: icons[value] ?? null,
  }));

  // Each emulated console as its own source, like Steam / Epic (biggest first).
  const consoles = useMemo(() => {
    const counts = new Map<
      string,
      { label: string; name: string; count: number }
    >();
    for (const game of library) {
      // Emulated consoles, plus PC ports of console games (their own "PORT" tab).
      if (game.shop !== "launchbox" && game.platform !== "port") continue;
      const badge = getPlatformBadge(game);
      const entry = counts.get(badge.tone) ?? {
        label: badge.label,
        name: badge.name,
        count: 0,
      };
      entry.count += 1;
      counts.set(badge.tone, entry);
    }
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [library]);

  return (
    <div className="library-category-filter__container">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`library-category-filter__option ${category === option.value ? "library-category-filter__option--active" : ""}`}
          onClick={() => onCategoryChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
      {consoles.length > 1 && (
        <span className="library-category-filter__divider" aria-hidden="true" />
      )}
      {consoles.length > 1 &&
        consoles.map(([tone, { label, name, count }]) => {
          const value = `console:${tone}` as LibraryCategory;
          return (
            <button
              key={tone}
              type="button"
              title={name}
              className={`library-category-filter__option ${category === value ? "library-category-filter__option--active" : ""}`}
              onClick={() => onCategoryChange(value)}
            >
              <span
                className={`platform-badge platform-badge--${tone} library-category-filter__console`}
              >
                {label}
              </span>
              <span className="library-category-filter__count">{count}</span>
            </button>
          );
        })}
    </div>
  );
}
