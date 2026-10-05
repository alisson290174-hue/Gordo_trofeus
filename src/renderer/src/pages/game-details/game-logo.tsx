import { useEffect, useState } from "react";
import type { Game, ShopDetailsWithAssets } from "@types";
import { getLogoArt } from "@renderer/helpers/ps5-game";

interface GameLogoProps {
  game: Game | null;
  shopDetails: ShopDetailsWithAssets | null;
}

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  return customUrl || originalUrl || fallbackUrl || "";
};

export function GameLogo({ game, shopDetails }: Readonly<GameLogoProps>) {
  const isCustomGame = game?.shop === "custom";

  const logoImage = isCustomGame
    ? game?.logoImageUrl || ""
    : getImageWithCustomPriority(
        game?.customLogoImageUrl,
        shopDetails?.assets?.logoImageUrl,
        game
          ? getLogoArt(game)
          : shopDetails
            ? getLogoArt({ shop: "steam", objectId: shopDetails.objectId })
            : null
      );

  const title = game?.title || shopDetails?.name || "";

  // A logo that 404s falls back to the title in text, like the handoff's logoFail state.
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [logoImage]);

  if (logoImage && !hasFailed) {
    return (
      <img
        src={logoImage}
        className="game-details__game-logo"
        alt={title}
        onError={() => setHasFailed(true)}
      />
    );
  }

  return <div className="game-details__game-logo-text">{title}</div>;
}
