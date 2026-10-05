import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { resolvePreferredGameAssets } from "../../../../helpers";

export interface GameAchievementsHeroProps {
  shopDetails: ShopDetailsWithAssets;
  game: LibraryGame | null;
}

export function GameAchievementsHero({
  shopDetails,
  game,
}: Readonly<GameAchievementsHeroProps>) {
  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, shopDetails.assets),
    [game, shopDetails.assets]
  );

  // A logo that fails to load shows the game's name instead of a broken-image icon.
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [preferredAssets.logoSrc]);

  return (
    <section className="game-achievements-page__hero">
      <motion.div
        initial={{ scale: 1, x: 0, y: 0 }}
        animate={{ scale: 1.08, x: -8, y: -8 }}
        transition={{
          duration: 20,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "mirror",
        }}
        className="game-achievements-page__hero-bg"
        style={{
          backgroundImage: `url(${preferredAssets.heroSrc})`,
        }}
      />

      <div className="game-achievements-page__hero-overlay">
        {preferredAssets.logoSrc && !logoFailed ? (
          <img
            src={preferredAssets.logoSrc}
            alt={preferredAssets.title}
            className="game-achievements-page__hero-logo"
            onError={() => setLogoFailed(true)}
          />
        ) : preferredAssets.title ? (
          <h1 className="game-achievements-page__hero-title">
            {preferredAssets.title}
          </h1>
        ) : null}
      </div>
    </section>
  );
}
