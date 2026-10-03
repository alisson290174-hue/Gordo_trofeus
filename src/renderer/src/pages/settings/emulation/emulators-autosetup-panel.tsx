import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmulatorAutoSetupProgress } from "@types";
import { Button } from "@renderer/components";
import { Icon } from "@renderer/components/icon/icon";
import { useToast } from "@renderer/hooks";
import "./emulators-autosetup-panel.scss";

const TARGET_LABELS: Record<EmulatorAutoSetupProgress["target"], string> = {
  ps1: "PS1",
  ps2: "PS2",
  ps3: "PS3",
  psp: "PSP",
  dolphin: "GameCube/Wii",
  switch: "Switch",
  "3ds": "3DS",
  retroarch: "RetroArch",
};

interface Props {
  /** Reload the console cards once emulators were installed or the folder changed. */
  onChanged: () => void;
}

/**
 * "Emuladores do Balói": where emulators live and a one-click install + configure of all of them,
 * so a new user only links their game folders.
 */
export function EmulatorsAutoSetupPanel({ onChanged }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [baseDir, setBaseDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [results, setResults] = useState<EmulatorAutoSetupProgress[]>([]);

  useEffect(() => {
    window.electron.getEmulatorsBaseDir().then(setBaseDir).catch(() => setBaseDir(null));
  }, []);

  useEffect(() => {
    return window.electron.onEmulatorAutoSetupProgress((progress) => {
      if (progress.status === "working") {
        setCurrent(TARGET_LABELS[progress.target]);
        return;
      }
      setResults((previous) => [
        ...previous.filter((r) => r.target !== progress.target),
        progress,
      ]);
    });
  }, []);

  const handleChangeFolder = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath: baseDir ?? undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;
    try {
      setBaseDir(await window.electron.setEmulatorsBaseDir(result.filePaths[0]));
      showSuccessToast(t("emulators_folder_changed"));
    } catch {
      showErrorToast(t("emulators_folder_change_failed"));
    }
  }, [baseDir, showErrorToast, showSuccessToast, t]);

  const handleSetupAll = useCallback(async () => {
    setRunning(true);
    setResults([]);
    try {
      const all = await window.electron.autoSetupEmulators();
      setResults(all);
      const failed = all.filter((r) => r.status === "failed").length;
      if (failed > 0) showErrorToast(t("emulators_setup_some_failed", { count: failed }));
      else showSuccessToast(t("emulators_setup_done"));
    } catch {
      showErrorToast(t("emulators_setup_failed"));
    } finally {
      setRunning(false);
      setCurrent(null);
      onChanged();
    }
  }, [onChanged, showErrorToast, showSuccessToast, t]);

  return (
    <section className="emulators-autosetup">
      <div className="emulators-autosetup__text">
        <h3 className="emulators-autosetup__title">{t("emulators_autosetup_title")}</h3>
        <p className="emulators-autosetup__description">{t("emulators_autosetup_description")}</p>
        <button type="button" className="emulators-autosetup__folder" onClick={handleChangeFolder}>
          <Icon name="folder" size={14} />
          <span className="emulators-autosetup__folder-path">{baseDir ?? "…"}</span>
          <span className="emulators-autosetup__folder-change">{t("emulators_folder_change")}</span>
        </button>
      </div>

      <div className="emulators-autosetup__actions">
        <Button theme="primary" onClick={handleSetupAll} disabled={running}>
          <Icon name={running ? "sync" : "download"} size={16} />
          {running
            ? t("emulators_setup_running", { name: current ?? "…" })
            : t("emulators_setup_all")}
        </Button>
        {results.length > 0 && (
          <ul className="emulators-autosetup__results">
            {results.map((result) => (
              <li
                key={result.target}
                className={`emulators-autosetup__chip emulators-autosetup__chip--${result.status}`}
                title={result.executablePath ?? result.reason ?? ""}
              >
                {TARGET_LABELS[result.target]} · {t(`emulators_setup_status_${result.status}`)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
