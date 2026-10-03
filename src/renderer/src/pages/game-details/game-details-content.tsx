import { Icon } from "@renderer/components/icon/icon";
import { Img } from "@renderer/components";
import HeroPlaceholder from "@renderer/assets/library-catalogue/hero-placeholder.jpg";
import CoverPlaceholder from "@renderer/assets/library-catalogue/cover-placeholder.png";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HeroPanelActions } from "./hero/hero-panel-actions";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";
import { GameReviews } from "./game-reviews";
import { ReviewPromptBanner } from "./review-prompt-banner";
import { useReviewPrompt } from "./use-review-prompt";
import { useUserReviewStatus } from "./use-user-review-status";
import { GameLogo } from "./game-logo";
import { getGenreNames, getHeroArt } from "@renderer/helpers/ps5-game";
import { CloudSaveWidget } from "./cloud-save-v2";
import { getCloudSaveVisibility } from "./cloud-save-visibility";
import { SimilarGames } from "./similar-games/similar-games";

import {
  AuthPage,
  getDisplayedPlayTimeInMilliseconds,
  isLocalOnlyShop,
  sanitizeRichHtml,
} from "@shared";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import {
  useUserDetails,
  useLibrary,
  useAppSelector,
  useDownload,
} from "@renderer/hooks";
import {
  CLASSICS_PS_PLATFORM_LABELS,
  resolveClassicsBadge,
} from "@renderer/helpers";
import {
  Ps5HeroStats,
  Ps5InfoCard,
  Ps5TrophiesCard,
} from "./ps5/ps5-details";
import "./game-details.scss";
import "./hero.scss";

const processMediaElements = (document: Document) => {
  const $images = Array.from(document.querySelectorAll("img"));
  $images.forEach(($image) => {
    $image.loading = "lazy";
    $image.removeAttribute("width");
    $image.removeAttribute("height");
    $image.removeAttribute("style");
    $image.style.maxWidth = "100%";
    $image.style.width = "auto";
    $image.style.height = "auto";
    $image.style.boxSizing = "border-box";
  });

  // Handle videos the same way
  const $videos = Array.from(document.querySelectorAll("video"));
  $videos.forEach(($video) => {
    $video.removeAttribute("width");
    $video.removeAttribute("height");
    $video.removeAttribute("style");
    $video.style.maxWidth = "100%";
    $video.style.width = "auto";
    $video.style.height = "auto";
    $video.style.boxSizing = "border-box";
  });
};

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  return customUrl || originalUrl || fallbackUrl || "";
};

export function GameDetailsContent() {
  const { t } = useTranslation("game_details");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { lastPacket } = useDownload();
  const extraction = useAppSelector((state) => state.download.extraction);
  const reviewsRef = useRef<HTMLDivElement>(null);

  const {
    objectId,
    shopDetails,
    game,
    hasNSFWContentBlocked,
    shop,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
  } = useContext(gameDetailsContext);

  const { userDetails } = useUserDetails();
  const { library } = useLibrary();

  const { getGameArtifacts } = useContext(cloudSyncContext);
  const cloudSaveVisibility = game ? getCloudSaveVisibility(game.shop) : null;

  const aboutTheGame = useMemo(() => {
    const aboutTheGame = shopDetails?.about_the_game;
    if (aboutTheGame) {
      const document = new DOMParser().parseFromString(
        aboutTheGame,
        "text/html"
      );

      processMediaElements(document);

      // Store HTML is untrusted: no scripts/handlers, only http(s) media and links.
      return sanitizeRichHtml(document.body.outerHTML);
    }

    // Local-only games (custom, Epic) and emulator games outside the catalogue (fan translations,
    // homebrew) have no server details — no error message for them.
    if (isLocalOnlyShop(game?.shop) || game?.shop === "launchbox") {
      return "";
    }

    return t("no_shop_details");
  }, [shopDetails, t, game?.shop]);

  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDescriptionOverflowing, setIsDescriptionOverflowing] =
    useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);

  // Check if the current game is in the user's library
  const isGameInLibrary = useMemo(() => {
    if (!library || !shop || !objectId) return false;
    return library.some(
      (libItem) => libItem.shop === shop && libItem.objectId === objectId
    );
  }, [library, shop, objectId]);

  const { hasUserReviewed, isCheckingUserReview, updateHasUserReviewed } =
    useUserReviewStatus({
      shop,
      objectId,
      userDetailsId: userDetails?.id,
    });

  const { showPrompt, dismissPrompt } = useReviewPrompt({
    shop,
    objectId,
    playTimeInMilliseconds: getDisplayedPlayTimeInMilliseconds({
      playTimeInMilliseconds: game?.playTimeInMilliseconds ?? 0,
      steamPlayTimeInMilliseconds: game?.steamPlayTimeInMilliseconds,
    }),
    userDetailsId: userDetails?.id,
    isGameInLibrary,
    hasUserReviewed,
    isCheckingUserReview,
  });

  const handleReviewPromptYes = () => {
    dismissPrompt({ persist: false });
    reviewsRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleReviewPromptLater = () => {
    dismissPrompt({ persist: true });
  };


  useLayoutEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      setIsDescriptionOverflowing(false);
      return;
    }

    const measure = () => {
      const collapsedMaxHeight = 300;
      setIsDescriptionOverflowing(el.scrollHeight > collapsedMaxHeight);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    const images = Array.from(el.querySelectorAll("img"));
    const onMediaLoad = () => measure();
    images.forEach((img) => {
      if (!img.complete) img.addEventListener("load", onMediaLoad);
    });

    return () => {
      observer.disconnect();
      images.forEach((img) => img.removeEventListener("load", onMediaLoad));
    };
  }, [aboutTheGame]);

  const handleLegacyCloudSaveButtonClick = () => {
    if (!userDetails) {
      globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    setGameOptionsInitialCategory("hydra_cloud_legacy");
    setShowGameOptionsModal(true);
  };

  const handleEditGameClick = () => {
    setGameOptionsInitialCategory("assets");
    setShowGameOptionsModal(true);
  };

  useEffect(() => {
    getGameArtifacts();
  }, [getGameArtifacts]);

  // Scroll to reviews section if reviews=true in URL
  useEffect(() => {
    const shouldScrollToReviews = searchParams.get("reviews") === "true";
    if (shouldScrollToReviews && reviewsRef.current) {
      setTimeout(() => {
        reviewsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 500);
    }
  }, [searchParams, objectId]);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const classicsUseHeroLayout = userPreferences?.classicsUseHeroLayout ?? false;

  const isCustomGame = game?.shop === "custom";
  const isLaunchboxGame = shop === "launchbox";
  // Classics with real fanart (PS2 index) get the full hero like PC games; the cover-centric
  // layout stays for games whose only art is the box scan.
  const launchboxHero =
    game?.customHeroImageUrl ||
    shopDetails?.assets?.libraryHeroImageUrl ||
    game?.libraryHeroImageUrl ||
    null;
  const hasClassicsFanart = Boolean(
    launchboxHero &&
      !launchboxHero.includes("xlenore/ps2-covers") &&
      launchboxHero !== game?.coverImageUrl
  );
  const renderClassicsHero =
    isLaunchboxGame && !classicsUseHeroLayout && !hasClassicsFanart;

  const heroImage = isCustomGame
    ? game?.libraryHeroImageUrl || game?.iconUrl || ""
    : getImageWithCustomPriority(
        game?.customHeroImageUrl,
        shopDetails?.assets?.libraryHeroImageUrl,
        // Same chain as Início: vitrine embutida → biblioteca → CDN da Steam.
        shop && objectId
          ? getHeroArt({ ...(game ?? {}), shop, objectId })
          : null
      );

  const launchboxCover = isLaunchboxGame
    ? game?.customCoverImageUrl ||
      shopDetails?.assets?.coverImageUrl ||
      shopDetails?.assets?.libraryImageUrl ||
      game?.libraryImageUrl ||
      game?.coverImageUrl ||
      game?.libraryHeroImageUrl ||
      shopDetails?.assets?.iconUrl ||
      game?.iconUrl ||
      ""
    : "";

  const resolvedHeroImage = isLaunchboxGame
    ? heroImage || launchboxCover
    : heroImage;

  const launchboxPlatform = isLaunchboxGame
    ? (game?.platform ?? shopDetails?.platform ?? null)
    : null;

  const launchboxTitle = isLaunchboxGame
    ? (game?.title ?? shopDetails?.name ?? "")
    : "";

  const classicsPlatformLabel = isLaunchboxGame
    ? (resolveClassicsBadge("launchbox", launchboxPlatform, CLASSICS_PS_PLATFORM_LABELS, {
        emulatorIcons: {},
        retroarchIcon: "",
      }).label ?? launchboxPlatform)
    : null;

  const heroImageContent = resolvedHeroImage ? (
    <Img
      src={resolvedHeroImage}
      fallback={HeroPlaceholder}
      className="game-details__hero-image"
      alt={game?.title}
    />
  ) : (
    <div className="game-details__hero-image game-details__hero-image--placeholder" />
  );

  const metaLine = [
    classicsPlatformLabel,
    shopDetails?.developers?.[0],
    shopDetails?.release_date?.date?.match(/\d{4}/)?.[0],
    getGenreNames(shopDetails?.genres)[0],
  ]
    .filter(Boolean)
    .join(" · ");

  const shortDescription = useMemo(() => {
    const html = shopDetails?.short_description;
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim() || null;
  }, [shopDetails?.short_description]);

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;
  const showDownloadProgress =
    (game?.download?.status === "active" && game.download.progress < 1) ||
    game?.download?.status === "paused";
  const isExtracting = Boolean(game) && extraction?.visibleId === game?.id;

  return (
    <div
      className={`game-details__wrapper ${hasNSFWContentBlocked ? "game-details__wrapper--blurred" : ""}`}
    >
      <section className="game-details__container">
        <div className="gd5-hero">
          <div className="gd5-hero__art">
            {renderClassicsHero ? (
              <div className="gd5-hero__classics-backdrop">
                {launchboxCover && (
                  <img
                    src={launchboxCover}
                    alt=""
                    aria-hidden="true"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                )}
              </div>
            ) : (
              heroImageContent
            )}
          </div>
          <div className="gd5-hero__shade-x" />
          <div className="gd5-hero__shade-y" />

          <div className="gd5-hero__content">
            <button
              type="button"
              className="gd5-hero__back"
              onClick={() => navigate(-1)}
            >
              <Icon name="arrow-left" size={16} />
              <span>{t("dashboard:back")}</span>
            </button>

            {renderClassicsHero ? (
              <div className="gd5-hero__classics">
                {launchboxCover && (
                  <Img
                    className="gd5-hero__classics-cover"
                    src={launchboxCover}
                    fallback={CoverPlaceholder}
                    alt={game?.title}
                  />
                )}
                <div className="gd5-hero__classics-meta">
                  <h1 className="gd5-hero__title-text">{launchboxTitle}</h1>
                </div>
              </div>
            ) : (
              <div className="gd5-hero__logo">
                <GameLogo game={game} shopDetails={shopDetails} />
              </div>
            )}

            {metaLine && <div className="gd5-hero__meta">{metaLine}</div>}

            <div className="gd5-hero__actions">
              <HeroPanelActions />

              {game && (
                <button
                  type="button"
                  className="gd5-hero__round"
                  onClick={handleEditGameClick}
                  title={t("edit_game_modal_button")}
                >
                  <Icon name="pencil" size={18} />
                </button>
              )}

              {game && cloudSaveVisibility?.hero === "legacy" && (
                <button
                  type="button"
                  className="gd5-hero__cloud"
                  onClick={handleLegacyCloudSaveButtonClick}
                >
                  <Icon name="cloud" size={20} />
                  {t("cloud_save")}
                </button>
              )}

              {game && objectId && cloudSaveVisibility?.hero === "v2" && (
                <div className="gd5-hero__cloud-widget">
                  <CloudSaveWidget />
                </div>
              )}
            </div>

            {(showDownloadProgress || isExtracting) && (
              <div className="gd5-hero__progress">
                <span
                  className={
                    game?.download?.status === "paused"
                      ? "gd5-hero__progress-fill gd5-hero__progress-fill--paused"
                      : "gd5-hero__progress-fill"
                  }
                  style={{
                    width: `${Math.round(
                      (isExtracting
                        ? (extraction?.progress ?? 0)
                        : isGameDownloading
                          ? (lastPacket?.progress ?? 0)
                          : (game?.download?.progress ?? 0)) * 100
                    )}%`,
                  }}
                />
              </div>
            )}

            <Ps5HeroStats />
          </div>
        </div>

        <div className="gd5-body">
          <div className="gd5-body__main">
            {shortDescription && (
              <div className="gd5-about">
                <span className="ps5-eyebrow">{t("dashboard:about")}</span>
                <p className="gd5-about__text">{shortDescription}</p>
              </div>
            )}

            <Ps5TrophiesCard />

            {showPrompt && (
              <ReviewPromptBanner
                onYesClick={handleReviewPromptYes}
                onLaterClick={handleReviewPromptLater}
              />
            )}

            <GallerySlider />

            <div
              ref={descriptionRef}
              dangerouslySetInnerHTML={{
                __html: aboutTheGame,
              }}
              className={`game-details__description ${
                isDescriptionExpanded
                  ? "game-details__description--expanded"
                  : isDescriptionOverflowing
                    ? "game-details__description--collapsed"
                    : ""
              }`}
            />

            {aboutTheGame && isDescriptionOverflowing && (
              <button
                type="button"
                className="game-details__description-toggle"
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
              >
                {isDescriptionExpanded ? t("show_less") : t("show_more")}
              </button>
            )}

            {shop && objectId && !isLocalOnlyShop(shop) && (
              <SimilarGames objectId={objectId} shop={shop} />
            )}

            {!isLocalOnlyShop(shop) && shop && objectId && (
              <div ref={reviewsRef}>
                <GameReviews
                  shop={shop}
                  objectId={objectId}
                  game={game}
                  userDetailsId={userDetails?.id}
                  hasUserReviewed={hasUserReviewed}
                  isCheckingUserReview={isCheckingUserReview}
                  onUserReviewedChange={updateHasUserReviewed}
                />
              </div>
            )}
          </div>

          {shop !== "custom" && (
            <div className="gd5-body__side">
              <Ps5InfoCard />
              <Sidebar />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
