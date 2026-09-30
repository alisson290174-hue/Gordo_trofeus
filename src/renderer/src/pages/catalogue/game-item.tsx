import { Icon } from "@renderer/components/icon/icon";
import { buildGameDetailsPath } from "@renderer/helpers";
import { getShowcaseArt } from "@renderer/helpers/showcase";
import { useAppSelector, useLibrary } from "@renderer/hooks";
import { lazy, Suspense, useMemo, useState, useEffect } from "react";
import { Link } from "@renderer/components/link/link";
import CoverPlaceholder from "@renderer/assets/library-catalogue/cover-placeholder.png";

import "./game-item.scss";
import { useTranslation } from "react-i18next";
import { CatalogueSearchResult } from "@types";

import cn from "classnames";

const ProtonDBBadge = lazy(async () => {
  const mod = await import("./protondb-badge");
  return { default: mod.ProtonDBBadge };
});

export interface GameItemProps {
  game: CatalogueSearchResult;
}

export function GameItem({ game }: GameItemProps) {
  const { i18n, t } = useTranslation("game_details");

  const language = i18n.language.split("-")[0];

  const { steamGenres } = useAppSelector((state) => state.catalogueSearch);

  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);

  const [added, setAdded] = useState(false);

  const { library, updateLibrary } = useLibrary();
  const shouldShowProtonFeatures = window.electron.platform === "linux";

  useEffect(() => {
    const exists = library.some(
      (libItem) =>
        libItem.shop === game.shop && libItem.objectId === game.objectId
    );
    setAdded(exists);
  }, [library, game.shop, game.objectId]);

  const addGameToLibrary = async () => {
    if (added || isAddingToLibrary) return;

    setIsAddingToLibrary(true);

    try {
      await window.electron.addGameToLibrary(
        game.shop,
        game.objectId,
        game.title,
        game.platform ?? null
      );
      updateLibrary();
    } catch (error) {
      console.error(error);
    } finally {
      setIsAddingToLibrary(false);
    }
  };

  const genres = useMemo(() => {
    return game.genres?.map((genre) => {
      const index = steamGenres["en"]?.findIndex(
        (steamGenre) => steamGenre === genre
      );

      if (
        index !== undefined &&
        steamGenres[language] &&
        steamGenres[language][index]
      ) {
        return steamGenres[language][index];
      }

      return genre;
    });
  }, [game.genres, language, steamGenres]);

  const [coverFailed, setCoverFailed] = useState(false);
  const remoteCover = getShowcaseArt(game, "cover") ?? game.libraryImageUrl;
  const cover = !coverFailed && remoteCover ? remoteCover : CoverPlaceholder;
  const visibleSources = game.downloadSources.slice(0, 2);
  const hiddenSourcesCount = game.downloadSources.length - visibleSources.length;

  const rawProtonValue =
    game.tier ??
    game.bestReportedTier ??
    game.protondbSupportBadge ??
    game.protondbSupportBadges?.[0] ??
    null;
  const protonBadgeValue = rawProtonValue?.toLowerCase().trim() ?? null;
  const protonBadge =
    protonBadgeValue &&
    ["borked", "bronze", "silver", "gold", "platinum"].includes(
      protonBadgeValue
    )
      ? protonBadgeValue
      : null;

  return (
    <article className="game-item">
      <Link to={buildGameDetailsPath(game)} className="game-item__link">
        <div className="game-item__cover">
          <img
            src={cover}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
          />

          {shouldShowProtonFeatures && protonBadge && (
            <Suspense fallback={null}>
              <ProtonDBBadge badge={protonBadge} />
            </Suspense>
          )}
        </div>

        <div className="game-item__text">
          <span className="game-item__title">{game.title}</span>
          <span className="game-item__genres">
            {genres && genres.length > 0
              ? genres.slice(0, 3).join(", ")
              : t("no_genres", { ns: "catalogue" })}
          </span>

          {visibleSources.length > 0 && (
            <div className="game-item__sources">
              {visibleSources.map((sourceName) => (
                <span key={sourceName} className="game-item__source">
                  {sourceName}
                </span>
              ))}
              {hiddenSourcesCount > 0 && (
                <span className="game-item__source">+{hiddenSourcesCount}</span>
              )}
            </div>
          )}
        </div>
      </Link>

      <button
        type="button"
        className={cn("game-item__add", {
          "game-item__add--added": added,
        })}
        onClick={addGameToLibrary}
        title={added ? t("already_in_library") : t("add_to_library")}
        aria-label={added ? t("already_in_library") : t("add_to_library")}
        disabled={added || isAddingToLibrary}
      >
        <Icon name={added ? "check" : "plus"} size={16} />
      </button>
    </article>
  );
}
