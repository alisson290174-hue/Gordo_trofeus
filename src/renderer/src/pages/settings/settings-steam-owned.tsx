import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { SteamIcon } from "@renderer/components/steam-library-badge/steam-library-badge";
import { useToast, useUserDetails } from "@renderer/hooks";
import { SettingsIntegrationCard } from "./settings-integration-card";

type SyncResult = { visible: boolean; total: number; installed: number };

/**
 * Steam account games. No extra sign-in: the Balói login already is a Steam login, so our server
 * lists the account's games with its own Steam Web API key. Install/play go through Steam.
 */
export function SettingsSteamOwned() {
  const { t } = useTranslation("settings");
  const { userDetails } = useUserDetails();
  const { showErrorToast } = useToast();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    try {
      setResult(await window.electron.syncSteamOwnedLibrary());
    } catch {
      showErrorToast(t("steam_owned_sync_failed"));
    } finally {
      setIsSyncing(false);
    }
  }, [showErrorToast, t]);

  useEffect(() => {
    if (userDetails) void sync();
  }, [userDetails, sync]);

  const status = !userDetails
    ? t("steam_owned_signed_out")
    : result && !result.visible
      ? t("steam_owned_private")
      : t("steam_owned_linked", { name: userDetails.displayName });

  return (
    <SettingsIntegrationCard
      title={t("steam")}
      logo={<SteamIcon size={18} />}
      status={status}
      statusTone={userDetails && result?.visible !== false ? "success" : "warning"}
      loading={Boolean(userDetails) && isSyncing && !result}
      actions={
        userDetails ? (
          <Button theme="outline" onClick={() => void sync()} disabled={isSyncing}>
            {isSyncing ? t("steam_owned_syncing") : t("steam_owned_sync")}
          </Button>
        ) : null
      }
    >
      <p className="settings-epic__description">
        {result?.visible === false
          ? t("steam_owned_private_hint")
          : result
            ? t("steam_owned_count", { count: result.total, installed: result.installed })
            : t("steam_owned_description")}
      </p>
    </SettingsIntegrationCard>
  );
}
