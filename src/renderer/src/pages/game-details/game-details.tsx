import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { GameShop } from "@types";

import { ConfirmationModal } from "@renderer/components";

import { useTranslation } from "react-i18next";
import { SkeletonTheme } from "react-loading-skeleton";
import { GameDetailsSkeleton } from "./game-details-skeleton";

import { GameDetailsContent } from "./game-details-content";
import {
  CloudSyncContextConsumer,
  CloudSyncContextProvider,
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "@renderer/context";
import { GameOptionsModal } from "./modals";
import { CloudSyncFilesModal } from "./cloud-sync-files-modal/cloud-sync-files-modal";
import { CloudSaveV2Provider } from "./cloud-save-v2";
import "./game-details.scss";
import "./hero.scss";

export default function GameDetails() {
  const { objectId, shop } = useParams();
  const [searchParams] = useSearchParams();

  const gameTitle = searchParams.get("title");

  const { t } = useTranslation("game_details");

  const navigate = useNavigate();

  useEffect(() => {
    if (shop !== "steam" || !objectId) return;

    void window.electron.syncSteamGameOnGamePage(objectId).catch(() => {});
  }, [objectId, shop]);

  return (
    <GameDetailsContextProvider
      gameTitle={gameTitle!}
      shop={shop! as GameShop}
      objectId={objectId!}
    >
      <GameDetailsContextConsumer>
        {({
          isLoading,
          game,
          gameTitle,
          shop,
          showGameOptionsModal,
          gameOptionsInitialCategory,
          hasNSFWContentBlocked,
          setHasNSFWContentBlocked,
          setShowGameOptionsModal,
          setGameOptionsInitialCategory,
        }) => {
          const handleNSFWContentRefuse = () => {
            setHasNSFWContentBlocked(false);
            navigate(-1);
          };

          return (
            <CloudSaveV2Provider objectId={objectId!} shop={shop}>
              <CloudSyncContextProvider objectId={objectId!} shop={shop}>
                <CloudSyncContextConsumer>
                  {({
                    showCloudSyncFilesModal,
                    setShowCloudSyncFilesModal,
                  }) => (
                    <>
                      <CloudSyncFilesModal
                        onClose={() => setShowCloudSyncFilesModal(false)}
                        visible={showCloudSyncFilesModal}
                      />
                    </>
                  )}
                </CloudSyncContextConsumer>

                <SkeletonTheme baseColor="#121a2c" highlightColor="#1e2940">
                  {isLoading ? <GameDetailsSkeleton /> : <GameDetailsContent />}

                  <ConfirmationModal
                    visible={hasNSFWContentBlocked}
                    onClose={handleNSFWContentRefuse}
                    title={t("nsfw_content_title")}
                    descriptionText={t("nsfw_content_description", {
                      title: gameTitle,
                    })}
                    confirmButtonLabel={t("allow_nsfw_content")}
                    cancelButtonLabel={t("refuse_nsfw_content")}
                    onConfirm={() => setHasNSFWContentBlocked(false)}
                    clickOutsideToClose={false}
                  />

                  {game && (
                    <GameOptionsModal
                      visible={showGameOptionsModal}
                      game={game}
                      onClose={() => {
                        setShowGameOptionsModal(false);
                        setGameOptionsInitialCategory("general");
                      }}
                      initialCategory={gameOptionsInitialCategory}
                      onNavigateHome={() => navigate("/")}
                    />
                  )}
                </SkeletonTheme>
              </CloudSyncContextProvider>
            </CloudSaveV2Provider>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
