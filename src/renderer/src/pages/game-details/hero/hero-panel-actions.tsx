
import { useEpicInstalls } from "@renderer/hooks/use-epic-installs";
import { Button, ConfirmationModal } from "@renderer/components";
import { Icon } from "@renderer/components/icon/icon";
import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { gameDetailsContext } from "@renderer/context";
import { handleClassicsLaunchError } from "@renderer/helpers";
import { DiscSelectionModal } from "../modals/disc-selection-modal";
import { EpicInstallModal } from "../modals/epic-install-modal";

import "./hero-panel-actions.scss";
import { useEffect } from "react";

export function HeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);

  const { isGameDeleting } = useDownload();
  const { userDetails } = useUserDetails();

  const {
    game,
    repacks,
    isGameRunning,
    shop,
    objectId,
    gameTitle,
    shopDetails,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
    setShowRepacksModal,
    updateGame,
    selectGameExecutable,
    isTransferring,
    transferProgress,
  } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

  const { updateLibrary } = useLibrary();

  const { showSuccessToast, showErrorToast } = useToast();

  const navigate = useNavigate();

  const [showDiscSelectionModal, setShowDiscSelectionModal] = useState(false);
  const [showEpicInstallModal, setShowEpicInstallModal] = useState(false);
  const [pendingClassicsLaunch, setPendingClassicsLaunch] = useState<{
    discPath: string | undefined;
  } | null>(null);

  const { t } = useTranslation("game_details");
  const epicInstalls = useEpicInstalls();

  useEffect(() => {
    const onOpenDiscSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ objectId?: string }>).detail;
      if (!detail?.objectId || detail.objectId === game?.objectId) {
        if (game?.shop === "launchbox" && (game?.discs?.length ?? 0) > 1) {
          setShowDiscSelectionModal(true);
        }
      }
    };
    window.addEventListener(
      "hydra:openDiscSelection",
      onOpenDiscSelection as EventListener
    );
    return () => {
      window.removeEventListener(
        "hydra:openDiscSelection",
        onOpenDiscSelection as EventListener
      );
    };
  }, [game?.objectId, game?.shop, game?.discs?.length]);

  useEffect(() => {
    const onFavoriteToggled = () => {
      updateLibrary();
      updateGame();
    };

    const onGameRemoved = () => {
      updateLibrary();
      updateGame();
    };

    const onFilesRemoved = () => {
      updateLibrary();
      updateGame();
    };

    window.addEventListener(
      "hydra:game-favorite-toggled",
      onFavoriteToggled as EventListener
    );
    window.addEventListener(
      "hydra:game-removed-from-library",
      onGameRemoved as EventListener
    );
    window.addEventListener(
      "hydra:game-files-removed",
      onFilesRemoved as EventListener
    );

    return () => {
      window.removeEventListener(
        "hydra:game-favorite-toggled",
        onFavoriteToggled as EventListener
      );
      window.removeEventListener(
        "hydra:game-removed-from-library",
        onGameRemoved as EventListener
      );
      window.removeEventListener(
        "hydra:game-files-removed",
        onFilesRemoved as EventListener
      );
    };
  }, [updateLibrary, updateGame]);

  const addGameToLibrary = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      await window.electron.addGameToLibrary(
        shop,
        objectId!,
        gameTitle,
        shopDetails?.platform ?? null
      );

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const toggleGameFavorite = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game?.favorite && objectId) {
        await window.electron
          .removeGameFromFavorites(shop, objectId)
          .then(() => {
            showSuccessToast(t("game_removed_from_favorites"));
          });
      } else {
        if (!objectId) return;

        await window.electron.addGameToFavorites(shop, objectId).then(() => {
          showSuccessToast(t("game_added_to_favorites"));
        });
      }

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const toggleGamePinned = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game?.isPinned && objectId) {
        await window.electron.toggleGamePin(shop, objectId, false).then(() => {
          showSuccessToast(t("game_removed_from_pinned"));
        });
      } else {
        if (!objectId) return;

        await window.electron.toggleGamePin(shop, objectId, true).then(() => {
          showSuccessToast(t("game_added_to_pinned"));
        });
      }

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const launchClassicsWithErrorHandling = async (
    discPath?: string,
    force?: boolean
  ): Promise<void> => {
    if (!game) return;
    try {
      await window.electron.openClassicsGame(
        game.shop,
        game.objectId,
        discPath,
        force
      );
    } catch (error) {
      handleClassicsLaunchError(error, {
        t,
        showErrorToast,
        showSuccessToast,
        navigate,
        onEmulatorAlreadyRunning: () => setPendingClassicsLaunch({ discPath }),
      });
    }
  };

  const openClassicsGame = async () => {
    if (!game) return;

    const discs = game.discs ?? [];

    if (discs.length <= 1) {
      await launchClassicsWithErrorHandling();
      return;
    }

    if (game.dontAskDiscSelection && game.selectedDiscPath) {
      await launchClassicsWithErrorHandling(game.selectedDiscPath);
      return;
    }

    setShowDiscSelectionModal(true);
  };

  const handleDiscSelectionConfirm = async (
    discPath: string,
    dontAskAgain: boolean
  ) => {
    if (!game) return;
    setShowDiscSelectionModal(false);
    try {
      await window.electron.updateClassicsDisc(game.shop, game.objectId, {
        selectedDiscPath: discPath,
        dontAskDiscSelection: dontAskAgain,
      });
      updateGame();
    } catch (error) {
      // non-fatal; still try to launch
    }
    await launchClassicsWithErrorHandling(discPath);
  };

  const openGame = async () => {
    if (!game) return;

    if (game.shop === "launchbox") {
      await openClassicsGame();
      return;
    }

    if (game.executablePath) {
      window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath,
        game.launchOptions
      );
      return;
    }

    const gameExecutablePath = await selectGameExecutable();
    if (gameExecutablePath)
      window.electron.openGame(
        game.shop,
        game.objectId,
        gameExecutablePath,
        game.launchOptions
      );
  };

  const closeGame = () => {
    if (game) window.electron.closeGame(game.shop, game.objectId);
  };

  const deleting = game ? isGameDeleting(game?.id) : false;

  const addGameToLibraryButton = (
    <Button
      theme="outline"
      disabled={toggleLibraryGameDisabled}
      onClick={addGameToLibrary}
      className="hero-panel-actions__action hero-panel-actions__primary"
    >
      <Icon name="plus-circle"  />
      {t("add_to_library")}
    </Button>
  );

  const showDownloadOptionsButton = (
    <Button
      onClick={() => setShowRepacksModal(true)}
      theme="outline"
      disabled={deleting}
      className="hero-panel-actions__action hero-panel-actions__ghost"
    >
      <Icon name="download" size={18} />
      {t("open_download_options")}
    </Button>
  );

  const gameActionButton = () => {
    if (isTransferring) {
      const percent = Math.round(transferProgress * 100);
      return (
        <Button
          theme="outline"
          className="hero-panel-actions__action hero-panel-actions__primary hero-panel-actions__primary--muted"
          onClick={() => {
            setGameOptionsInitialCategory("locations");
            setShowGameOptionsModal(true);
          }}
        >
          <span
            className="hero-panel-actions__fill"
            style={{ width: `${percent}%` }}
          />
          <Icon name="download" size={18} />
          <span>{t("dashboard:transferring", { percent })}</span>
        </Button>
      );
    }

    if (isGameRunning) {
      return (
        <Button
          onClick={closeGame}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action hero-panel-actions__primary hero-panel-actions__primary--muted"
        >
          <Icon name="x" size={18} />
          {t("close")}
        </Button>
      );
    }

    const isPlayableClassics =
      game?.shop === "launchbox" && (game?.discs?.length ?? 0) > 0;

    // Steam account game with no copy of its own: install / play through the Steam client.
    if (game?.shop === "steam" && game.hasActiveSteamImport && !game.executablePath) {
      if (game.steamInstalled) {
        return (
          <Button
            onClick={openGame}
            theme="outline"
            disabled={deleting || isGameRunning}
            className="hero-panel-actions__action hero-panel-actions__primary"
          >
            <Icon name="play" size={18} />
            {t("play")}
          </Button>
        );
      }
      return (
        <Button
          onClick={() => window.electron.installThroughSteam(game.objectId)}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action hero-panel-actions__primary"
        >
          <Icon name="download" size={18} />
          {t("dashboard:steam_install")}
        </Button>
      );
    }

    // Epic: install/update through Legendary straight from Opus.
    if (game?.shop === "epic" && !game.executablePath) {
      const install = epicInstalls[game.objectId];
      if (install && install.status !== "error") {
        const percent = Math.round(install.percent);
        return (
          <Button
            theme="outline"
            className="hero-panel-actions__action hero-panel-actions__primary hero-panel-actions__primary--muted"
            onClick={() => window.electron.cancelEpicInstall(game.objectId)}
            title={t("dashboard:epic_cancel_install")}
          >
            <span className="hero-panel-actions__fill" style={{ width: `${percent}%` }} />
            <Icon name="download" size={18} />
            <span>
              {install.status === "downloading"
                ? t("dashboard:epic_installing", { percent })
                : t("dashboard:epic_preparing")}
            </span>
          </Button>
        );
      }

      return (
        <Button
          onClick={() =>
            install?.status === "error"
              ? // Retry resumes in the folder chosen before (Legendary keeps the partial download).
                window.electron.installEpicGame(game.objectId, game.title)
              : setShowEpicInstallModal(true)
          }
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action hero-panel-actions__primary"
        >
          <Icon name="download" size={18} />
          {install?.status === "error" ? t("dashboard:epic_retry_install") : t("dashboard:epic_install")}
        </Button>
      );
    }

    if (game?.executablePath || isPlayableClassics) {
      return (
        <Button
          onClick={openGame}
          theme="outline"
          disabled={deleting || isGameRunning}
          className="hero-panel-actions__action hero-panel-actions__primary"
        >
          <Icon name="play" size={18} />
          {t("play")}
        </Button>
      );
    }

    // Downloaded but not set up yet (an installer or archive, no executable): run the installer
    // or open the folder — same action as on the Downloads page, instead of "Download" again.
    if (game?.download?.status === "complete" && !isGameDownloading) {
      return (
        <Button
          onClick={() => {
            void window.electron.openGameInstaller(game.shop, game.objectId).then((opened) => {
              if (!opened) showErrorToast(t("executable_not_found_title"));
            });
          }}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action hero-panel-actions__primary"
        >
          <Icon name="download" size={18} />
          {t("install")}
        </Button>
      );
    }

    if (isGameDownloading) {
      const percent = Math.round((lastPacket?.progress ?? 0) * 100);
      return (
        <Button
          onClick={() => navigate("/downloads")}
          theme="outline"
          className="hero-panel-actions__action hero-panel-actions__primary hero-panel-actions__primary--muted"
        >
          <span
            className="hero-panel-actions__fill"
            style={{ width: `${percent}%` }}
          />
          <Icon name="download" size={18} />
          <span>{t("dashboard:transferring", { percent })}</span>
        </Button>
      );
    }

    return (
      <Button
        onClick={() => setShowRepacksModal(true)}
        theme="outline"
        className={`hero-panel-actions__action hero-panel-actions__primary ${repacks.length === 0 ? "hero-panel-actions__action--disabled" : ""}`}
      >
        <Icon name="download" size={18} />
        {t("download")}
      </Button>
    );
  };

  if (repacks.length && !game) {
    return (
      <div className="hero-panel-actions__container">
        {addGameToLibraryButton}
        {showDownloadOptionsButton}
      </div>
    );
  }

  if (game) {
    return (
      <div className="hero-panel-actions__container">
        {gameActionButton()}
        <Button
          onClick={toggleGameFavorite}
          theme="outline"
          disabled={deleting}
          className={`hero-panel-actions__action hero-panel-actions__round ${game.favorite ? "hero-panel-actions__round--favorite" : ""}`}
        >
          <Icon name={game.favorite ? "heart-fill" : "heart"} size={20} />
        </Button>

        {userDetails && game.shop !== "custom" && (
          <Button
            onClick={toggleGamePinned}
            theme="outline"
            disabled={deleting}
            className={`hero-panel-actions__action hero-panel-actions__round ${game.isPinned ? "hero-panel-actions__round--pinned" : ""}`}
          >
            <Icon name="pin" size={20} />
          </Button>
        )}

        <Button
          onClick={() => {
            setGameOptionsInitialCategory("general");
            setShowGameOptionsModal(true);
          }}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action hero-panel-actions__round"
          title={t("options")}
        >
          <Icon name="kebab-horizontal" size={20} />
        </Button>

        {game.shop === "epic" && (
          <EpicInstallModal
            visible={showEpicInstallModal}
            appName={game.objectId}
            title={game.title}
            onClose={() => setShowEpicInstallModal(false)}
          />
        )}

        {game.shop === "launchbox" && (
          <DiscSelectionModal
            visible={showDiscSelectionModal}
            discs={game.discs ?? []}
            defaultDiscPath={game.selectedDiscPath ?? null}
            defaultDontAsk={Boolean(game.dontAskDiscSelection)}
            onClose={() => setShowDiscSelectionModal(false)}
            onConfirm={handleDiscSelectionConfirm}
          />
        )}

        <ConfirmationModal
          visible={pendingClassicsLaunch !== null}
          title={t("rpcs3_already_running_title")}
          descriptionText={t("rpcs3_already_running_description")}
          confirmButtonLabel={t("rpcs3_already_running_confirm")}
          cancelButtonLabel={t("cancel")}
          onClose={() => setPendingClassicsLaunch(null)}
          onConfirm={() => {
            const pending = pendingClassicsLaunch;
            setPendingClassicsLaunch(null);
            if (pending) {
              void launchClassicsWithErrorHandling(pending.discPath, true);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="hero-panel-actions__container">
      {addGameToLibraryButton}
    </div>
  );
}
