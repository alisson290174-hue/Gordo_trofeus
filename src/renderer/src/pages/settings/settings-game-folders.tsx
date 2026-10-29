import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useLibrary, useToast } from "@renderer/hooks";

/** Folders Opus watches for PC games installed by hand (Configurações › Geral). */
export function SettingsGameFolders() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { updateLibrary } = useLibrary();
  const { showSuccessToast } = useToast();
  const [folders, setFolders] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    window.electron.getGameFolders().then(setFolders);
  }, []);

  const save = async (next: string[]) => {
    setFolders(next);
    await updateUserPreferences({ gameFolders: next });
  };

  const handleAdd = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    const folder = filePaths?.[0];
    if (folder && !folders.includes(folder)) await save([...folders, folder]);
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const added = await window.electron.findNewFolderGames();
      updateLibrary();
      showSuccessToast(
        added.length
          ? t("game_folders_scan_found", {
              list: added.map((game) => game.title).join(", "),
            })
          : t("game_folders_scan_none")
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="settings-context-panel__group">
      <h3>{t("game_folders")}</h3>
      <p className="settings-context-panel__description">
        {t("game_folders_description")}
      </p>

      {folders.map((folder) => (
        <TextField
          key={folder}
          value={folder}
          readOnly
          disabled
          rightContent={
            <Button
              theme="outline"
              onClick={() => save(folders.filter((item) => item !== folder))}
            >
              {t("game_folders_remove")}
            </Button>
          }
        />
      ))}

      <div className="settings-context-panel__actions">
        <Button theme="outline" onClick={handleAdd}>
          {t("game_folders_add")}
        </Button>
        <Button theme="outline" onClick={handleScan} disabled={scanning}>
          {t("game_folders_scan_now")}
        </Button>
      </div>
    </div>
  );
}
