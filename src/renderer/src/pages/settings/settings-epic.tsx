import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EpicStatus } from "@types";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { SettingsIntegrationCard } from "./settings-integration-card";

import "./settings-epic.scss";

const DISCONNECTED: EpicStatus = {
  connected: false,
  displayName: null,
  gamesAvailable: null,
  gamesInstalled: null,
};

function EpicBadge() {
  return <span className="settings-epic__badge">EPIC</span>;
}

/**
 * Epic Games account (through Legendary). Login happens on Epic's own page in an isolated
 * window; the session is stored only on this PC and never reaches the Opus server.
 */
export function SettingsEpic() {
  const { t } = useTranslation("settings");
  const { showErrorToast, showSuccessToast } = useToast();

  const [status, setStatus] = useState<EpicStatus>(DISCONNECTED);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await window.electron
      .getEpicStatus()
      .catch(() => DISCONNECTED);
    setStatus(next);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleConnect = async () => {
    setIsBusy(true);
    try {
      const { ok, status: next } = await window.electron.loginToEpic();
      setStatus(next);
      if (ok) showSuccessToast(t("epic_connected_toast"));
      else if (!next.connected) showErrorToast(t("epic_login_failed"));
    } catch {
      showErrorToast(t("epic_login_failed"));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setIsBusy(true);
    try {
      setStatus(await window.electron.logoutFromEpic());
    } catch {
      showErrorToast(t("epic_logout_failed"));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <SettingsIntegrationCard
      title={t("epic_games")}
      logo={<EpicBadge />}
      status={
        status.connected
          ? t("epic_connected_as", { name: status.displayName })
          : t("epic_not_connected")
      }
      statusTone={status.connected ? "success" : "neutral"}
      loading={isLoading}
      actions={
        status.connected ? (
          <Button theme="outline" onClick={handleDisconnect} disabled={isBusy}>
            {t("epic_disconnect")}
          </Button>
        ) : (
          <Button theme="primary" onClick={handleConnect} disabled={isBusy}>
            {isBusy ? t("epic_connecting") : t("epic_connect")}
          </Button>
        )
      }
    >
      <p className="settings-epic__description">
        {status.connected
          ? t("epic_games_count", {
              count: status.gamesAvailable ?? 0,
              installed: status.gamesInstalled ?? 0,
            })
          : t("epic_description")}
      </p>
    </SettingsIntegrationCard>
  );
}
