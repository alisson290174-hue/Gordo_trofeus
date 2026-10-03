import cn from "classnames";
import { getPlatformBadge } from "@renderer/helpers/platform-badge";
import "./platform-badge.scss";

interface PlatformBadgeProps {
  game: { shop?: string | null; platform?: string | null };
  className?: string;
}

/** Console tag on a cover ("PS2", "SWITCH", "PC"), coloured like the console's branding. */
export function PlatformBadge({ game, className }: Readonly<PlatformBadgeProps>) {
  const badge = getPlatformBadge(game);
  return (
    <span
      className={cn("platform-badge", `platform-badge--${badge.tone}`, className)}
      title={badge.name}
    >
      {badge.label}
    </span>
  );
}
