import type { AchievementTier } from "@shared";
import "./trophy-cup.scss";

/**
 * PSN-style trophy artwork. `TrophySprite` holds the shared gradients + cup shapes and must be
 * mounted once per screen that renders cups; `TrophyCup` then draws a cup for a given rarity tier
 * by referencing that sprite, so the (heavy) gradient/path definitions exist only once in the DOM.
 */
export function TrophySprite() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      className="trophy-sprite"
    >
      <defs>
        <linearGradient id="baloi-cup-bronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0b078" />
          <stop offset=".5" stopColor="#c87a3a" />
          <stop offset="1" stopColor="#8f501f" />
        </linearGradient>
        <linearGradient id="baloi-cup-silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6f8fc" />
          <stop offset=".5" stopColor="#c3c9d6" />
          <stop offset="1" stopColor="#868da0" />
        </linearGradient>
        <linearGradient id="baloi-cup-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset=".5" stopColor="#f4b52f" />
          <stop offset="1" stopColor="#b9760a" />
        </linearGradient>
        <linearGradient id="baloi-plat-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbfdff" />
          <stop offset=".55" stopColor="#c8d0dd" />
          <stop offset="1" stopColor="#8b93a6" />
        </linearGradient>
        <radialGradient id="baloi-plat-orb" cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#dff4ff" />
          <stop offset=".45" stopColor="#5fc0ff" />
          <stop offset="1" stopColor="#1d6fc4" />
        </radialGradient>

        {/* classic cup (bronze/silver/gold) — fill + stroke inherited from the <svg> per tier */}
        <symbol id="baloi-cup" viewBox="0 0 48 56">
          <path d="M13 6h22v9c0 8-4.6 14-11 14S13 23 13 15z" />
          <path
            d="M13 8c-6 0-8 5-6.5 9.5C7.7 21 11 22 13.5 22M35 8c6 0 8 5 6.5 9.5C40.3 21 37 22 34.5 22"
            fill="none"
            style={{ strokeWidth: 2.6 }}
          />
          <path d="M21.5 28h5v9h-5zM15 37h18l2.5 6h-23zM12 44h24v3H12z" />
          <g fill="rgba(0,0,0,0.28)" stroke="none">
            <path d="M24 9.2l1.7 3h-3.4z" />
            <rect x="16.9" y="13.2" width="3" height="3" rx="0.4" />
            <circle cx="30.5" cy="14.7" r="1.6" />
            <path
              d="M22.6 18.1l2.8 2.8m0-2.8l-2.8 2.8"
              stroke="rgba(0,0,0,0.28)"
              strokeWidth="1.1"
              fill="none"
            />
          </g>
        </symbol>

        {/* platinum — silver cradle holding a blue orb, colours baked in */}
        <symbol id="baloi-cup-plat" viewBox="0 0 48 56">
          <path
            d="M13 8c-6 0-8 5-6.5 9.5C7.7 21 11 22 13.5 22M35 8c6 0 8 5 6.5 9.5C40.3 21 37 22 34.5 22"
            fill="url(#baloi-plat-body)"
            stroke="url(#baloi-plat-body)"
            style={{ strokeWidth: 2.6 }}
          />
          <path
            d="M21.5 28h5v9h-5zM15 37h18l2.5 6h-23zM12 44h24v3H12z"
            fill="url(#baloi-plat-body)"
          />
          <ellipse
            cx="24"
            cy="15"
            rx="12"
            ry="13"
            fill="url(#baloi-plat-orb)"
          />
          <g fill="rgba(255,255,255,0.85)" stroke="none">
            <path d="M24 8.5l1.9 3.3h-3.8z" />
            <rect x="16.4" y="13" width="3.2" height="3.2" rx="0.5" />
            <circle cx="31" cy="14.8" r="1.8" />
            <path
              d="M22.4 18.4l3 3m0-3l-3 3"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="1.2"
              fill="none"
            />
          </g>
        </symbol>
      </defs>
    </svg>
  );
}

interface TrophyCupProps {
  tier: AchievementTier;
  className?: string;
}

export function TrophyCup({ tier, className }: Readonly<TrophyCupProps>) {
  const href = tier === "platinum" ? "#baloi-cup-plat" : "#baloi-cup";
  return (
    <svg
      viewBox="0 0 48 56"
      className={`trophy-cup trophy-cup--${tier}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <use href={href} />
    </svg>
  );
}
