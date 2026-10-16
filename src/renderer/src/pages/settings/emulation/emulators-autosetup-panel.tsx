import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmulatorAutoSetupProgress } from "@types";
import { Button } from "@renderer/components";
import { Icon } from "@renderer/components/icon/icon";
import { useToast } from "@renderer/hooks";
import { RetroAchievementsEmulatorsModal } from "./retroachievements-emulators-modal";
import "./emulators-autosetup-panel.scss";

type Target = EmulatorAutoSetupProgress["target"];

/** Console label, the emulator Opus installs for it, and the consoles it covers. */
const TARGETS: { target: Target; console: string; emulator: string }[] = [
  { target: "ps1", console: "PS1", emulator: "DuckStation" },
  { target: "ps2", console: "PS2", emulator: "PCSX2" },
  { target: "ps3", console: "PS3", emulator: "RPCS3" },
  { target: "ps4", console: "PS4", emulator: "shadPS4" },
  { target: "psp", console: "PSP", emulator: "PPSSPP" },
  { target: "switch", console: "Switch", emulator: "Eden" },
  { target: "3ds", console: "3DS", emulator: "Azahar" },
  { target: "dolphin", console: "GameCube/Wii", emulator: "Dolphin" },
  {
    target: "retroarch",
    console: "SNES · NES · N64 · GBA · GB · DS",
    emulator: "RetroArch",
  },
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
 * "Emuladores do Opus": where emulators live, and each emulator installed + configured (controller
 * included) with one click, or all of them at once, so a new user only links their game folders.
 */
export function EmulatorsAutoSetupPanel({ onChanged }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [baseDir, setBaseDir] = useState<string | null>(null);
  const [rows, setRows] = useState<Partial<Record<Target, RowState>>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [versions, setVersions] = useState<
    Partial<Record<Target, string | null>>
  >({});
  const [configuring, setConfiguring] = useState<Target | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [downloadingTranslations, setDownloadingTranslations] = useState(false);
  const [raModalOpen, setRaModalOpen] = useState(false);
  // Emulators already signed in to RetroAchievements through Opus (token kept encrypted).
  const [raSignedIn, setRaSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    if (raModalOpen) return;
    window.electron
      .hasRaEmulatorSession()
      .then(setRaSignedIn)
      .catch(() => setRaSignedIn(null));
  }, [raModalOpen]);
  const [installingMods, setInstallingMods] = useState(false);

  const handleSwitchMods = async () => {
    setInstallingMods(true);
    try {
      const results = await window.electron.installAllSwitchMods();
      showSuccessToast(
        t("switch_mods_all_done", {
          count: results.filter((r) => r.status === "installed").length,
        })
      );
    } catch {
      showErrorToast(t("switch_mods_all"));
    } finally {
      setInstallingMods(false);
    }
  };

  const refreshStates = useCallback(async () => {
    const versionList = await window.electron
      .getEmulatorVersions()
      .catch(() => []);
    setVersions(
      Object.fromEntries(
        versionList.map((entry) => [entry.target, entry.version])
      )
    );
    const states = await window.electron
      .getEmulatorSetupStates()
      .catch(() => []);
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
    window.electron
      .getEmulatorsBaseDir()
      .then(setBaseDir)
      .catch(() => setBaseDir(null));
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
      setBaseDir(
        await window.electron.setEmulatorsBaseDir(result.filePaths[0])
      );
      showSuccessToast(t("emulators_folder_changed"));
    } catch {
      showErrorToast(t("emulators_folder_change_failed"));
    }
  }, [baseDir, showErrorToast, showSuccessToast, t]);

  // "Baixar": download / install only.
  const handleInstallOne = useCallback(
    async (target: Target) => {
      setRows((previous) => ({ ...previous, [target]: "working" }));
      try {
        const result = await window.electron.installEmulatorOnly(target);
        const ok =
          result.status !== "failed" && result.status !== "unavailable";
        setRows((previous) => ({
          ...previous,
          [target]: ok ? "installed" : "failed",
        }));
        if (ok)
          showSuccessToast(
            t("emulators_install_one_done", { name: LABEL[target] })
          );
        else
          showErrorToast(
            t("emulators_setup_one_failed", { name: LABEL[target] })
          );
      } catch {
        setRows((previous) => ({ ...previous, [target]: "failed" }));
        showErrorToast(
          t("emulators_setup_one_failed", { name: LABEL[target] })
        );
      } finally {
        await refreshStates();
        onChanged();
      }
    },
    [onChanged, refreshStates, showErrorToast, showSuccessToast, t]
  );

  // "Configurar": controller, graphics for this PC and achievements.
  const handleConfigureOne = useCallback(
    async (target: Target) => {
      setConfiguring(target);
      try {
        const ok = await window.electron.configureEmulatorOnly(target);
        if (ok)
          showSuccessToast(
            t("emulators_configure_one_done", { name: LABEL[target] })
          );
        else
          showErrorToast(
            t("emulators_configure_one_failed", { name: LABEL[target] })
          );
      } finally {
        setConfiguring(null);
      }
    },
    [showErrorToast, showSuccessToast, t]
  );

  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    try {
      const updated = await window.electron.checkEmulatorUpdates();
      if (updated.length)
        showSuccessToast(t("emulators_updated", { list: updated.join(", ") }));
      else showSuccessToast(t("emulators_up_to_date"));
    } catch {
      showErrorToast(t("emulators_update_check_failed"));
    } finally {
      setCheckingUpdates(false);
      await refreshStates();
    }
  }, [refreshStates, showErrorToast, showSuccessToast, t]);

  const handleDownloadTranslations = useCallback(async () => {
    setDownloadingTranslations(true);
    showSuccessToast(
      t("emulators_translations_online_searching"),
      undefined,
      120_000
    );
    try {
      await window.electron.downloadAllTranslationsOnline();
      showSuccessToast(t("emulators_translations_online_done"));
    } catch {
      showErrorToast(t("emulators_translations_failed"));
    } finally {
      setDownloadingTranslations(false);
      onChanged();
    }
  }, [onChanged, showErrorToast, showSuccessToast, t]);

  const handleSetupAll = useCallback(async () => {
    setRunningAll(true);
    try {
      const all = await window.electron.autoSetupEmulators();
      const failed = all.filter((r) => r.status === "failed").length;
      if (failed > 0)
        showErrorToast(t("emulators_setup_some_failed", { count: failed }));
      else showSuccessToast(t("emulators_setup_done"));
    } catch {
      showErrorToast(t("emulators_setup_failed"));
    } finally {
      setRunningAll(false);
      await refreshStates();
      onChanged();
    }
  }, [onChanged, refreshStates, showErrorToast, showSuccessToast, t]);

  const [translating, setTranslating] = useState(false);

  // Every translation in a folder ("traducoes") installed into the matching Switch/3DS games.
  const handleTranslationsFolder = useCallback(
    async (system: "switch" | "3ds") => {
      const picked = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
      });
      if (picked.canceled || picked.filePaths.length === 0) return;
      setTranslating(true);
      try {
        const results = await window.electron.installTranslationsFromFolder(
          system,
          picked.filePaths[0]
        );
        const installed = results.filter(
          (r) => r.status === "installed"
        ).length;
        const already = results.filter(
          (r) => r.status === "already_installed"
        ).length;
        showSuccessToast(
          t("emulators_translations_done", { installed, already })
        );
      } catch {
        showErrorToast(t("emulators_translations_failed"));
      } finally {
        setTranslating(false);
      }
    },
    [showErrorToast, showSuccessToast, t]
  );

  const anyWorking = runningAll || Object.values(rows).includes("working");

  return (
    <section className="emulators-autosetup">
      <RetroAchievementsEmulatorsModal
        visible={raModalOpen}
        onClose={() => setRaModalOpen(false)}
      />
      <div className="emulators-autosetup__header">
        <div className="emulators-autosetup__text">
          <h3 className="emulators-autosetup__title">
            {t("emulators_autosetup_title")}
          </h3>
          <p className="emulators-autosetup__description">
            {t("emulators_autosetup_description")}
          </p>
          <button
            type="button"
            className="emulators-autosetup__folder"
            onClick={handleChangeFolder}
          >
            <Icon name="folder-open" size={14} />
            <span className="emulators-autosetup__folder-path">
              {baseDir ?? "…"}
            </span>
            <span className="emulators-autosetup__folder-change">
              {t("emulators_folder_change")}
            </span>
          </button>
        </div>
        <div className="emulators-autosetup__header-actions">
          <Button
            theme="outline"
            onClick={handleSetupAll}
            disabled={anyWorking}
          >
            <Icon name={runningAll ? "sync" : "download"} size={16} />
            {t("emulators_setup_all")}
          </Button>
          <Button
            theme="outline"
            onClick={handleCheckUpdates}
            disabled={anyWorking || checkingUpdates}
          >
            <Icon name="sync" size={16} />
            {checkingUpdates
              ? t("emulators_checking_updates")
              : t("emulators_check_updates")}
          </Button>
          <Button
            theme="outline"
            onClick={handleSwitchMods}
            disabled={installingMods}
          >
            <Icon name={installingMods ? "sync" : "sliders"} size={16} />
            {t("switch_mods_all")}
          </Button>
          <Button
            theme={raSignedIn === false ? "primary" : "outline"}
            onClick={() => setRaModalOpen(true)}
          >
            <Icon name={raSignedIn ? "check" : "trophy"} size={16} />
            {raSignedIn
              ? t("ra_emulators_signed_in")
              : t("ra_emulators_button")}
          </Button>
          <Button
            theme="outline"
            onClick={handleDownloadTranslations}
            disabled={downloadingTranslations}
          >
            <Icon
              name={downloadingTranslations ? "sync" : "languages"}
              size={16}
            />
            {t("emulators_translations_online")}
          </Button>
          <Button
            theme="outline"
            onClick={() => handleTranslationsFolder("switch")}
            disabled={translating}
          >
            <Icon name={translating ? "sync" : "languages"} size={16} />
            {t("emulators_translations_switch")}
          </Button>
          <Button
            theme="outline"
            onClick={() => handleTranslationsFolder("3ds")}
            disabled={translating}
          >
            <Icon name={translating ? "sync" : "languages"} size={16} />
            {t("emulators_translations_3ds")}
          </Button>
        </div>
      </div>

      <ul className="emulators-autosetup__grid">
        {TARGETS.map(({ target, console, emulator }) => {
          const state = rows[target];
          const working = state === "working";
          return (
            <li
              key={target}
              className={`emulators-autosetup__card emulators-autosetup__card--${state ?? "missing"}`}
            >
              <div className="emulators-autosetup__card-text">
                <span className="emulators-autosetup__card-console">
                  {console}
                </span>
                <span className="emulators-autosetup__card-emulator">
                  {emulator}
                </span>
              </div>
              <span
                className={`emulators-autosetup__chip emulators-autosetup__chip--${state ?? "missing"}`}
              >
                {t(`emulators_row_${state ?? "missing"}`)}
              </span>
              {versions[target] && state === "installed" && (
                <span className="emulators-autosetup__card-version">
                  {versions[target]}
                </span>
              )}
              <div className="emulators-autosetup__card-actions">
                <Button
                  theme={state === "installed" ? "outline" : "primary"}
                  onClick={() => handleInstallOne(target)}
                  disabled={working || runningAll}
                >
                  <Icon name={working ? "sync" : "download"} size={14} />
                  {working
                    ? t("emulators_row_working")
                    : state === "installed"
                      ? t("emulators_row_reinstall")
                      : t("emulators_row_download")}
                </Button>
                <Button
                  theme="outline"
                  onClick={() => handleConfigureOne(target)}
                  disabled={
                    state !== "installed" || working || configuring === target
                  }
                >
                  <Icon
                    name={configuring === target ? "sync" : "settings"}
                    size={14}
                  />
                  {t("emulators_row_configure")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
