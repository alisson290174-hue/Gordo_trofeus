import type { LibraryGame } from "@types";
import { useEffect, useState } from "react";
import { useNavigationType } from "react-router-dom";
import { GridFocusGroup } from "../../../common";
import {
  getLibraryFocusGridItemId,
  LIBRARY_FOCUS_GRID_REGION_ID,
} from "../navigation";
import { useLibraryGridNavigation } from "../grid-navigation";
import { useLibraryGridLayout } from "./use-library-grid-layout";
import { VerticalLibraryGameCard } from "../game-card";

import "./focus-grid.scss";

/**
 * Mounting all ~560 cards at once cost ~0.9 s of script before anything showed. On a fresh visit
 * the first rows mount right away and the rest follow over the next frames. Coming back (POP) mounts
 * everything at once, so focus can return to a card far down the list.
 */
const FIRST_BATCH = 48;
const NEXT_BATCH = 96;

function useProgressiveCount(games: LibraryGame[], mountAll: boolean): number {
  const total = games.length;
  const [count, setCount] = useState(() =>
    mountAll ? total : Math.min(total, FIRST_BATCH)
  );
  // Another tab (LT/RT) or filter starts over from the first rows; a data refresh of the same
  // list (playtime, trophies) keeps every card mounted so focus never jumps.
  const signature = `${total}:${games[0]?.id ?? ""}:${games[total - 1]?.id ?? ""}`;
  const [shownSignature, setShownSignature] = useState(signature);
  if (shownSignature !== signature) {
    setShownSignature(signature);
    setCount(Math.min(total, FIRST_BATCH));
  }

  useEffect(() => {
    if (count >= total) return undefined;
    const id = requestAnimationFrame(() =>
      setCount((current) => Math.min(total, current + NEXT_BATCH))
    );
    return () => cancelAnimationFrame(id);
  }, [count, total]);

  return Math.min(count, total);
}

export interface LibraryFocusGridProps {
  games: LibraryGame[];
  contextMenuGameId?: string | null;
  onOpenContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

export function LibraryFocusGrid({
  games,
  contextMenuGameId = null,
  onOpenContextMenu,
}: Readonly<LibraryFocusGridProps>) {
  const navigationOverridesByItemId = useLibraryGridNavigation(games);
  const style = useLibraryGridLayout(games.length);
  const mountedCount = useProgressiveCount(
    games,
    useNavigationType() === "POP"
  );

  if (games.length === 0) return null;

  return (
    <section className="library-focus-grid">
      <GridFocusGroup
        className="library-focus-grid__grid"
        regionId={LIBRARY_FOCUS_GRID_REGION_ID}
        style={style}
      >
        {games.slice(0, mountedCount).map((game) => (
          <VerticalLibraryGameCard
            key={game.id}
            game={game}
            contextMenuOpen={contextMenuGameId === game.id}
            onOpenContextMenu={onOpenContextMenu}
            navigationOverrides={
              navigationOverridesByItemId[getLibraryFocusGridItemId(game.id)]
            }
          />
        ))}
      </GridFocusGroup>
    </section>
  );
}
