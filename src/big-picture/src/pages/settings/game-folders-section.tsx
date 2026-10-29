import {
  FolderPlusIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import {
  Button,
  FileExplorerModal,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import { useBigPictureToast } from "../../hooks";
import { tr } from "../../helpers/opus-text";
import {
  DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

const REGION_ID = "settings-game-folders";
const ACTIONS_REGION_ID = "settings-game-folders-actions";
const SCAN_BUTTON_ID = "settings-game-folders-scan";
const removeButtonId = (folder: string) =>
  `settings-game-folders-remove:${folder.toLowerCase()}`;

/**
 * Folders Opus watches for PC games installed by hand (same list as Configurações › Geral in the
 * desktop app), usable with the controller: add one through the on-screen file explorer, remove
 * one, or look for new games right now.
 */
export function GameFoldersSection({
  className,
}: Readonly<{ className?: string }>) {
  const { showSuccessToast } = useBigPictureToast();
  const [folders, setFolders] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    void globalThis.window.electron.getGameFolders().then(setFolders);
  }, []);

  const save = useCallback(async (next: string[]) => {
    setFolders(next);
    await globalThis.window.electron.updateUserPreferences({
      gameFolders: next,
    });
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const added = await globalThis.window.electron.findNewFolderGames();
      globalThis.window.dispatchEvent(new Event("library-update"));
      showSuccessToast(
        added.length
          ? tr("Added: ", "Adicionados: ") +
              added.map((game) => game.title).join(", ")
          : tr("No new games found", "Nenhum jogo novo encontrado")
      );
    } finally {
      setScanning(false);
    }
  }, [showSuccessToast]);

  return (
    <SettingsSection
      title={tr("Game folders", "Pastas de jogos")}
      description={tr(
        "Each new game folder inside these joins your library on its own, with its cover.",
        "Cada pasta de jogo nova dentro destas entra sozinha na biblioteca, com a capa."
      )}
      className={className}
    >
      <VerticalFocusGroup regionId={REGION_ID}>
        <HorizontalFocusGroup regionId={ACTIONS_REGION_ID}>
          <Button
            variant="secondary"
            size="small"
            icon={<FolderPlusIcon size={20} />}
            focusId={DOWNLOAD_DIRECTORIES_DEFAULT_SELECT_ID}
            focusNavigationOverrides={{ up: SETTINGS_HEADER_RETURN_TARGET }}
            onClick={() => setPickerOpen(true)}
          >
            {tr("Add folder", "Adicionar pasta")}
          </Button>
          <Button
            variant="secondary"
            size="small"
            icon={<MagnifyingGlassIcon size={20} />}
            focusId={SCAN_BUTTON_ID}
            focusNavigationOverrides={{ up: SETTINGS_HEADER_RETURN_TARGET }}
            disabled={scanning}
            onClick={() => void handleScan()}
          >
            {scanning
              ? tr("Looking…", "Procurando…")
              : tr("Look for new games now", "Procurar jogos novos agora")}
          </Button>
        </HorizontalFocusGroup>

        {folders.map((folder) => (
          <div key={folder} className="game-folders-section__row">
            <span className="game-folders-section__path">{folder}</span>
            <Button
              variant="secondary"
              size="small"
              icon={<TrashIcon size={18} />}
              focusId={removeButtonId(folder)}
              onClick={() =>
                void save(folders.filter((item) => item !== folder))
              }
            >
              {tr("Remove", "Remover")}
            </Button>
          </div>
        ))}
      </VerticalFocusGroup>

      <FileExplorerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(path: string) => {
          setPickerOpen(false);
          if (path && !folders.includes(path)) void save([...folders, path]);
        }}
        title={tr("Choose a games folder", "Escolha uma pasta de jogos")}
        initialPath={folders[0]}
        selectDirectory
      />
    </SettingsSection>
  );
}
