import type { GameShop } from "@types";
import { removeGameFromDeleting, setGameDeleting } from "@renderer/features";
import { useAppDispatch, useAppSelector } from "./redux";
import { useLibrary } from "./use-library";

/** Removing a game from the library and deleting its files from disk. */
export function useGameRemoval() {
  const dispatch = useAppDispatch();
  const { updateLibrary } = useLibrary();
  const gamesWithDeletionInProgress = useAppSelector(
    (state) => state.gameDeletion.gamesWithDeletionInProgress
  );

  const removeGameInstaller = async (shop: GameShop, objectId: string) => {
    dispatch(setGameDeleting(objectId));

    try {
      await window.electron.deleteGameFolder(shop, objectId);
      updateLibrary();
    } finally {
      dispatch(removeGameFromDeleting(objectId));
    }
  };

  const removeGameFromLibrary = (shop: GameShop, objectId: string) =>
    window.electron.removeGameFromLibrary(shop, objectId).then(() => {
      updateLibrary();
    });

  const isGameDeleting = (objectId: string) =>
    gamesWithDeletionInProgress.includes(objectId);

  return { removeGameInstaller, removeGameFromLibrary, isGameDeleting };
}
