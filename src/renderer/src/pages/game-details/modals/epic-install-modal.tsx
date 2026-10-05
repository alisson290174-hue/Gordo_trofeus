import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import { formatBytes } from "@shared";
import type { DiskUsage, EpicInstallPlan } from "@types";

import "./epic-install-modal.scss";

export interface EpicInstallModalProps {
  visible: boolean;
  appName: string;
  title: string;
  onClose: () => void;
}

/**
 * Asks where an Epic game goes before installing: shows Epic's download / installed sizes, the
 * folder (last one used by default) and the free space there — the install button stays off when
 * the game doesn't fit.
 */
export function EpicInstallModal({
  visible,
  appName,
  title,
  onClose,
}: EpicInstallModalProps) {
  const { t } = useTranslation("game_details");
  const [plan, setPlan] = useState<EpicInstallPlan | null>(null);
  const [folder, setFolder] = useState("");
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPlan(null);
    setError(null);
    setStarting(false);
    void window.electron.getEpicInstallPlan(appName).then((result) => {
      setPlan(result);
      setFolder(result.defaultPath);
    });
  }, [visible, appName]);

  useEffect(() => {
    if (!folder) return;
    setDisk(null);
    void window.electron
      .getDiskFreeSpace(folder)
      .then(setDisk)
      .catch(() => setDisk(null));
  }, [folder]);

  const chooseFolder = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: folder,
      properties: ["openDirectory", "createDirectory"],
    });
    if (filePaths?.length) setFolder(filePaths[0]);
  };

  const needed = plan?.installBytes ?? null;
  const notEnoughSpace = needed != null && disk != null && disk.free < needed;

  const install = async () => {
    setStarting(true);
    setError(null);
    try {
      await window.electron.installEpicGame(appName, title, folder);
      onClose();
    } catch {
      setError(t("epic_install_folder_error"));
      setStarting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("epic_install_title", { title })}
      onClose={onClose}
    >
      <div className="epic-install-modal">
        <dl className="epic-install-modal__sizes">
          <div>
            <dt>{t("epic_install_download_size")}</dt>
            <dd>
              {plan
                ? plan.downloadBytes != null
                  ? formatBytes(plan.downloadBytes)
                  : "—"
                : "…"}
            </dd>
          </div>
          <div>
            <dt>{t("epic_install_disk_size")}</dt>
            <dd>
              {plan
                ? plan.installBytes != null
                  ? formatBytes(plan.installBytes)
                  : "—"
                : "…"}
            </dd>
          </div>
          <div>
            <dt>{t("epic_install_free_space")}</dt>
            <dd
              className={notEnoughSpace ? "epic-install-modal__low" : undefined}
            >
              {disk ? formatBytes(disk.free) : "…"}
            </dd>
          </div>
        </dl>

        <TextField
          value={folder}
          readOnly
          disabled
          label={t("epic_install_folder")}
          error={notEnoughSpace ? t("epic_install_not_enough_space") : error}
          rightContent={
            <Button
              theme="outline"
              onClick={chooseFolder}
              disabled={starting || !plan}
            >
              {t("change")}
            </Button>
          }
        />
        <p className="epic-install-modal__hint">
          {t("epic_install_folder_hint")}
        </p>

        <div className="epic-install-modal__actions">
          <Button theme="outline" onClick={onClose} disabled={starting}>
            {t("cancel")}
          </Button>
          <Button
            onClick={install}
            disabled={!plan || !folder || starting || notEnoughSpace}
          >
            {t("install")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
