import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmulatorAutoSetupProgress } from "@types";
import { Button } from "@renderer/components";
import { Icon } from "@renderer/components/icon/icon";
import { useToast } from "@renderer/hooks";
import "./emulators-autosetup-panel.scss";

type Target = EmulatorAutoSetupProgress["target"];

/** Console label, the emulator Balói installs for it, and the consoles it covers. */
const TARGETS: { target: Target; console: string; emulator: string }[] = [
  { target: "ps1", console: "PS1", emulator: "DuckStation" },
  { target: "ps2", console: "PS2", emulator: "PCSX2" },
  { target: "ps3", console: "PS3", emulator: "RPCS3" },
  { target: "psp", console: "PSP", emulator: "PPSSPP" },
  { target: "switch", console: "Switch", emulator: "Eden" },
  { target: "3ds", console: "3DS", emulator: "Azahar" },
  { target: "dolphin", console: "GameCube/Wii", emulator: "Dolphin" },
  { target: "retroarch", console: "SNES · NES · N64 · GBA · GB", emulator: "RetroArch" },
];

const LABEL: Record<Target, string> = Object.fromEntries(
  TARGETS.map(({ target, console }) => [target, console])
) as Record<Target, string>;

type RowState = "installed" | "missing" | "working" | "failed";

interface Props {
  /** Reload the console cards once emulators were installed or the folder changed. */
  onChanged: () => void;
}

/**
 * "Emuladores do Balói": where emulators live, and each emulator installed + configured (controller
 * included) with one click, or all of them at once, so a new user only links their game folders.
 */
export function EmulatorsAutoSetupPanel({ onChanged }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [baseDir, setBaseDir] = useState<string | null>(null);
  const [rows, setRows] = useState<Partial<Record<Target, RowState>>>({});
  const [runningAll, setRunningAll] = useState(false);

  const refreshStates = useCallback(async () => {
    const states = await window.electron.getEmulatorSetupStates().catch(() => []);
    setRows((previous) => {
      const next = { ...previous };
      for (const state of states) {
        if (next[state.target] === "working") continue;
        next[state.target] = state.installed ? "installed" : "missing";
      }
      return next;
    });
  }, []);

  useEffect(() => {
    window.electron.getEmulatorsBaseDir().then(setBaseDir).catch(() => setBaseDir(null));
    void refreshStates();
  }, [refreshStates]);

  useEffect(() => {
    return window.electron.onEmulatorAutoSetupProgress((progress) => {
      const state: RowState =
        progress.status === "working"
          ? "working"
          : progress.status === "failed" || progress.status === "unavailable"
            ? "failed"
            : "installed";
      setRows((previous) => ({ ...previous, [progress.target]: state }));
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

  const handleSetupOne = useCallback(
    async (target: Target) => {
      setRows((previous) => ({ ...previous, [target]: "working" }));
      try {
        const result = await window.electron.autoSetupEmulator(target);
        const ok = result.status !== "failed" && result.status !== "unavailable";
        setRows((previous) => ({ ...previous, [target]: ok ? "installed" : "failed" }));
        if (ok) showSuccessToast(t("emulators_setup_one_done", { name: LABEL[target] }));
        else showErrorToast(t("emulators_setup_one_failed", { name: LABEL[target] }));
      } catch {
        setRows((previous) => ({ ...previous, [target]: "failed" }));
        showErrorToast(t("emulators_setup_one_failed", { name: LABEL[target] }));
      } finally {
        onChanged();
      }
    },
    [onChanged, showErrorToast, showSuccessToast, t]
  );

  const handleSetupAll = useCallback(async () => {
    setRunningAll(true);
    try {
      const all = await window.electron.autoSetupEmulators();
      const failed = all.filter((r) => r.status === "failed").length;
      if (failed > 0) showErrorToast(t("emulators_setup_some_failed", { count: failed }));
      else showSuccessToast(t("emulators_setup_done"));
    } catch {
      showErrorToast(t("emulators_setup_failed"));
    } finally {
      setRunningAll(false);
      await refreshStates();
      onChanged();
    }
  }, [onChanged, refreshStates, showErrorToast, showSuccessToast, t]);

  const anyWorking = runningAll || Object.values(rows).includes("working");

  return (
    <section className="emulators-autosetup">
      <div className="emulators-autosetup__header">
        <div className="emulators-autosetup__text">
          <h3 className="emulators-autosetup__title">{t("emulators_autosetup_title")}</h3>
          <p className="emulators-autosetup__description">{t("emulators_autosetup_description")}</p>
          <button type="button" className="emulators-autosetup__folder" onClick={handleChangeFolder}>
            <Icon name="folder-open" size={14} />
            <span className="emulators-autosetup__folder-path">{baseDir ?? "…"}</span>
            <span className="emulators-autosetup__folder-change">{t("emulators_folder_change")}</span>
          </button>
        </div>
        <Button theme="outline" onClick={handleSetupAll} disabled={anyWorking}>
          <Icon name={runningAll ? "sync" : "download"} size={16} />
          {t("emulators_setup_all")}
        </Button>
      </div>

      <ul className="emulators-autosetup__grid">
        {TARGETS.map(({ target, console, emulator }) => {
          const state = rows[target];
          const working = state === "working";
          return (
            <li key={target} className={`emulators-autosetup__card emulators-autosetup__card--${state ?? "missing"}`}>
              <div className="emulators-autosetup__card-text">
                <span className="emulators-autosetup__card-console">{console}</span>
                <span className="emulators-autosetup__card-emulator">{emulator}</span>
              </div>
              <span className={`emulators-autosetup__chip emulators-autosetup__chip--${state ?? "missing"}`}>
                {t(`emulators_row_${state ?? "missing"}`)}
              </span>
              <Button
                theme={state === "installed" ? "outline" : "primary"}
                onClick={() => handleSetupOne(target)}
                disabled={working || runningAll}
              >
                <Icon name={working ? "sync" : state === "installed" ? "settings" : "download"} size={14} />
                {working
                  ? t("emulators_row_working")
                  : state === "installed"
                    ? t("emulators_row_reconfigure")
                    : t("emulators_row_install")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
