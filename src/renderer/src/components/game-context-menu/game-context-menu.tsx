import { useTranslation } from "react-i18next";
import { Icon } from "@renderer/components/icon/icon";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthPage } from "@shared";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import {
  ContextMenu,
  ContextMenuItemData,
  ContextMenuProps,
  ConfirmationModal,
  CreateCollectionModal,
  useGameActions,
} from "..";
import { useGameCollections, useToast, useUserDetails } from "@renderer/hooks";
import { useCollectionContextMenu } from "@renderer/context";
import { getGameCollectionIds } from "@renderer/helpers";
import { RemoveGameFromLibraryModal } from "@renderer/pages/game-details/modals/remove-from-library-modal";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import type { GameCollection } from "@types";
import type { GameContextMenuGame } from "./game-context-menu.types";

interface GameContextMenuProps extends Omit<ContextMenuProps, "items"> {
  game: GameContextMenuGame;
  onPinToggle?: () => void;
  isPinned?: boolean;
  onCollectionContextMenu?: (
    event: React.MouseEvent<HTMLElement>,
    collection: GameCollection
  ) => void;
}

const FAVORITES_COLLECTION_ID = "__favorites__";

export function GameContextMenu({
  game,
  onPinToggle,
  isPinned,
  onCollectionContextMenu,
  visible,
  position,
  onClose,
}: GameContextMenuProps) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const { userDetails } = useUserDetails();
  const [searchParams] = useSearchParams();
  const [showConfirmRemoveLibrary, setShowConfirmRemoveLibrary] =
    useState(false);
  const [showConfirmRemoveFiles, setShowConfirmRemoveFiles] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] =
    useState(false);
  const [localCollectionIds, setLocalCollectionIds] = useState<string[]>(() =>
    getGameCollectionIds(game)
  );
  const [isFavoriteSelected, setIsFavoriteSelected] = useState(
    Boolean(game.favorite)
  );
  const [pendingCollectionId, setPendingCollectionId] = useState<string | null>(
    null
  );
  const [isFavoritePending, setIsFavoritePending] = useState(false);
  const {
    collections,
    isLoading: isCollectionsLoading,
    loadCollections,
    assignGameToCollection,
  } = useGameCollections();
  const {
    canPlay,
    isDeleting,
    isGameDownloading,
    isGameRunning,
    hasRepacks,
    creatingShortcut,
    creatingSteamShortcut,
    handlePlayGame,
    handleCloseGame,
    handleToggleFavorite,
    handleCreateShortcut,
    handleCreateSteamShortcut,
    handleOpenFolder,
    handleOpenDownloadOptions,
    handleOpenDownloadLocation,
    handleTogglePin,
    handleRemoveFromLibrary,
    handleRemoveFiles,
    handleOpenGameOptions,
    rpcs3ConfirmPending,
    handleConfirmRpcs3Launch,
    handleCancelRpcs3Launch,
  } = useGameActions(game);
  const { isCollectionContextMenuOrModalOpen } = useCollectionContextMenu();
  const selectedCollectionId = searchParams.get("collection");

  useEffect(() => {
    if (!visible || game.shop === "custom" || !userDetails) return;
    void loadCollections();
  }, [visible, game.shop, loadCollections, userDetails]);

  useEffect(() => {
    if (!visible) return;

    setLocalCollectionIds(getGameCollectionIds(game));
    setIsFavoriteSelected(Boolean(game.favorite));
    setPendingCollectionId(null);
    setIsFavoritePending(false);
  }, [visible, game]);

  const handleAssignGameCollection = async (collectionId: string) => {
    if (pendingCollectionId || isFavoritePending) return;

    const isCurrentlyAssigned = localCollectionIds.includes(collectionId);
    const nextCollectionIds = isCurrentlyAssigned
      ? localCollectionIds.filter((id) => id !== collectionId)
      : [...localCollectionIds, collectionId];

    setPendingCollectionId(collectionId);

    try {
      await assignGameToCollection(game, nextCollectionIds);

      setLocalCollectionIds(nextCollectionIds);

      showSuccessToast(t("game_collection_updated"));

      if (isCurrentlyAssigned && selectedCollectionId === collectionId) {
        onClose();
      }
    } catch (error) {
      void error;
      showErrorToast(t("failed_update_game_collection"));
    } finally {
      setPendingCollectionId(null);
    }
  };

  const handleFindArtwork = async () => {
    showSuccessToast(t("find_artwork_searching"));
    try {
      const result = await window.electron.findGameArtwork(game.shop, game.objectId);
      if (result.status === "applied") {
        showSuccessToast(t("find_artwork_applied", { title: result.matchedTitle }));
      } else if (result.status === "complete") {
        showSuccessToast(t("find_artwork_complete"));
      } else {
        showErrorToast(t("find_artwork_not_found"));
      }
    } catch {
      showErrorToast(t("find_artwork_not_found"));
    }
  };

  const handleToggleFavoriteStatus = async () => {
    if (isFavoritePending || pendingCollectionId) return;

    const isAddingToFavorites = !isFavoriteSelected;

    setIsFavoritePending(true);

    try {
      await handleToggleFavorite(isFavoriteSelected);

      setIsFavoriteSelected((currentValue) => !currentValue);

      if (
        !isAddingToFavorites &&
        selectedCollectionId === FAVORITES_COLLECTION_ID
      ) {
        onClose();
      }
    } catch (error) {
      void error;
    } finally {
      setIsFavoritePending(false);
    }
  };

  const collectionSubmenu: ContextMenuItemData[] = [
    {
      id: "favorite",
      label: t("favorites", { ns: "sidebar" }),
      icon: isFavoriteSelected ? (
        <Icon name="heart-fill" size={16} />
      ) : (
        <Icon name="heart" size={16} />
      ),
      onClick: () => {
        void handleToggleFavoriteStatus();
      },
      closeOnClick: false,
      disabled: isDeleting,
    },
    ...(game.shop === "custom"
      ? []
      : collections.map((collection) => ({
          id: `collection-${collection.id}`,
          label: collection.name,
          icon: localCollectionIds.includes(collection.id) ? (
            <Icon name="file-directory-fill" size={16} />
          ) : (
            <Icon name="file-directory" size={16} />
          ),
          onClick: () => {
            void handleAssignGameCollection(collection.id);
          },
          onContextMenu: onCollectionContextMenu
            ? (event: React.MouseEvent<HTMLElement>) => {
                event.preventDefault();
                event.stopPropagation();
                onCollectionContextMenu(event, collection);
              }
            : undefined,
          closeOnClick: false,
          disabled: isDeleting,
        }))),
    ...(game.shop === "custom"
      ? []
      : [
          {
            id: "collection-create",
            label: t("create_collection"),
            icon: <Icon name="plus" size={16} />,
            separator: collections.length > 0,
            onClick: () => {
              if (!userDetails) {
                window.electron.openAuthWindow(AuthPage.SignIn);
                return;
              }

              setShowCreateCollectionModal(true);
            },
            closeOnClick: false,
            disabled: isDeleting || Boolean(pendingCollectionId),
          },
        ]),
  ];

  const items: ContextMenuItemData[] = [
    {
      id: "play",
      label: isGameRunning ? t("close") : canPlay ? t("play") : t("download"),
      icon: isGameRunning ? (
        <Icon name="x" size={16} />
      ) : canPlay ? (
        <Icon name="play" size={16} />
      ) : (
        <Icon name="download" size={16} />
      ),
      onClick: () => {
        if (isGameRunning) {
          void handleCloseGame();
        } else if (canPlay) {
          void handlePlayGame();
        } else {
          handleOpenDownloadOptions();
        }
      },
      disabled: isDeleting,
    },
    {
      id: "collection",
      label: t("collection"),
      icon: <Icon name="file-directory" size={16} />,
      onClick: () => {
        if (game.shop === "custom") return;
        void loadCollections();
      },
      disabled: isDeleting || isFavoritePending || Boolean(pendingCollectionId),
      submenu:
        isCollectionsLoading && game.shop !== "custom"
          ? [
              {
                id: "collection-loading",
                label: t("loading"),
                disabled: true,
              },
            ]
          : collectionSubmenu,
    },
    ...(game.executablePath
      ? [
          {
            id: "shortcuts",
            label: t("create_shortcut_simple"),
            icon: <Icon name="link" size={16} />,
            disabled: isDeleting,
            submenu: [
              {
                id: "desktop-shortcut",
                label: t("create_shortcut_simple"),
                icon: <Icon name="link" size={16} />,
                onClick: handleCreateShortcut,
                disabled: isDeleting || creatingShortcut,
              },
              {
                id: "steam-shortcut",
                label: t("create_steam_shortcut"),
                icon: <SteamLogo style={{ width: 16, height: 16 }} />,
                onClick: handleCreateSteamShortcut,
                disabled: isDeleting || creatingSteamShortcut,
              },
            ],
          },
        ]
      : []),

    ...(game.shop === "steam" && game.executablePath
      ? [
          {
            id: "generate-goldberg-achievements",
            label: t("generate_achievements"),
            icon: <Icon name="trophy" size={16} />,
            disabled: isDeleting,
            onClick: async () => {
              const result = await window.electron
                .generateGoldbergAchievements(game.objectId, game.shop)
                .catch(() => ({ ok: false as const, reason: "write_failed" as const }));

              if (result.ok) {
                showSuccessToast(
                  t("generate_achievements_success", { count: result.count })
                );
              } else {
                showErrorToast(t(`generate_achievements_error_${result.reason}`));
              }
            },
          },
        ]
      : []),

    {
      id: "manage",
      label: t("options"),
      icon: <Icon name="settings" size={16} />,
      disabled: isDeleting,
      submenu: [
        {
          id: "pin-game",
          label:
            (isPinned ?? game.isPinned ?? false)
              ? t("unpin_game")
              : t("pin_game"),
          icon:
            (isPinned ?? game.isPinned ?? false) ? (
              <Icon name="pin-slash" size={16} />
            ) : (
              <Icon name="pin" size={16} />
            ),
          onClick: onPinToggle ?? handleTogglePin,
          disabled: isDeleting,
        },
        {
          id: "customize",
          label: t("customize_game"),
          icon: <Icon name="image" size={16} />,
          onClick: () => handleOpenGameOptions("assets"),
          disabled: isDeleting,
        },
        ...(game.shop !== "launchbox"
          ? [
              {
                id: "find-artwork",
                label: t("find_artwork"),
                icon: <Icon name="search" size={16} />,
                onClick: () => void handleFindArtwork(),
                disabled: isDeleting,
              },
            ]
          : []),
        ...(game.executablePath
          ? [
              {
                id: "open-folder",
                label: t("open_folder"),
                icon: <Icon name="file-directory" size={16} />,
                onClick: handleOpenFolder,
                disabled: isDeleting,
              },
            ]
          : []),
        ...(game.executablePath
          ? [
              {
                id: "download-options",
                label: t("open_download_options"),
                icon: <Icon name="download" size={16} />,
                onClick: handleOpenDownloadOptions,
                disabled: isDeleting || isGameDownloading || !hasRepacks,
              },
            ]
          : []),
        ...(game.download?.downloadPath
          ? [
              {
                id: "download-location",
                label: t("open_download_location"),
                icon: <Icon name="file-directory" size={16} />,
                onClick: handleOpenDownloadLocation,
                disabled: isDeleting,
              },
            ]
          : []),

        {
          id: "remove-library",
          label: t("remove_from_library"),
          icon: <Icon name="x" size={16} />,
          onClick: () => setShowConfirmRemoveLibrary(true),
          disabled: isDeleting,
          danger: true,
          closeOnClick: false,
        },
        ...(game.download?.downloadPath
          ? [
              {
                id: "remove-files",
                label: t("remove_files"),
                icon: <Icon name="trash" size={16} />,
                onClick: () => setShowConfirmRemoveFiles(true),
                disabled: isDeleting || isGameDownloading,
                danger: true,
                closeOnClick: false,
              },
            ]
          : []),
      ],
    },
    {
      id: "properties",
      label: t("properties"),
      separator: true,
      icon: <Icon name="pencil" size={16} />,
      onClick: () => handleOpenGameOptions(),
      disabled: isDeleting,
    },
  ];

  let forceOpenSubmenuId: string | undefined;
  if (showConfirmRemoveLibrary || showConfirmRemoveFiles) {
    forceOpenSubmenuId = "manage";
  } else if (isCollectionContextMenuOrModalOpen || showCreateCollectionModal) {
    forceOpenSubmenuId = "collection";
  }

  return (
    <>
      <ContextMenu
        items={items}
        visible={visible}
        position={position}
        onClose={onClose}
        forceOpenSubmenuId={forceOpenSubmenuId}
        className={
          !game.executablePath ? "context-menu--game-not-installed" : undefined
        }
      />

      <CreateCollectionModal
        visible={showCreateCollectionModal}
        onClose={() => setShowCreateCollectionModal(false)}
        onCreated={(collection) => {
          void (async () => {
            const nextCollectionIds = Array.from(
              new Set([...localCollectionIds, collection.id])
            );

            setPendingCollectionId(collection.id);

            try {
              await assignGameToCollection(game, nextCollectionIds);
              setLocalCollectionIds(nextCollectionIds);
              showSuccessToast(t("game_collection_updated"));
            } catch (error) {
              void error;
              showErrorToast(t("failed_update_game_collection"));
            } finally {
              setPendingCollectionId(null);
            }
          })();
        }}
      />

      <RemoveGameFromLibraryModal
        visible={showConfirmRemoveLibrary}
        game={game}
        onClose={() => setShowConfirmRemoveLibrary(false)}
        removeGameFromLibrary={async () => {
          setShowConfirmRemoveLibrary(false);
          onClose();
          await handleRemoveFromLibrary();
        }}
      />

      <DeleteGameModal
        visible={showConfirmRemoveFiles}
        onClose={() => setShowConfirmRemoveFiles(false)}
        deleteGame={() => {
          setShowConfirmRemoveFiles(false);
          onClose();
          void handleRemoveFiles();
        }}
      />

      <ConfirmationModal
        visible={rpcs3ConfirmPending !== null}
        title={t("rpcs3_already_running_title")}
        descriptionText={t("rpcs3_already_running_description")}
        confirmButtonLabel={t("rpcs3_already_running_confirm")}
        cancelButtonLabel={t("cancel")}
        onClose={handleCancelRpcs3Launch}
        onConfirm={handleConfirmRpcs3Launch}
      />
    </>
  );
}
