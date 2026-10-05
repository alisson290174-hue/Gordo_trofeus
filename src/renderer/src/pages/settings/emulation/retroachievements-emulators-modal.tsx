import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import { useToast } from "@renderer/hooks";

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * One login that signs every emulator into RetroAchievements. The password is sent once to
 * retroachievements.org by the main process and never kept; each emulator receives the token.
 */
export function RetroAchievementsEmulatorsModal({
  visible,
  onClose,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPassword("");
    window.electron
      .getUserPreferences()
      .then((prefs) => setUsername(prefs?.retroAchievementsUsername ?? ""))
      .catch(() => {});
  }, [visible]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      const result = await window.electron.loginRetroAchievementsInEmulators(
        username,
        password
      );
      if (result.ok) {
        showSuccessToast(t("ra_emulators_done"), result.configured.join(", "));
        onClose();
      } else {
        showErrorToast(
          t(
            result.reason === "invalid_credentials"
              ? "ra_emulators_bad_login"
              : "ra_emulators_network"
          )
        );
      }
    } finally {
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("ra_emulators_title")}
      description={t("ra_emulators_description")}
      onClose={() => !busy && onClose()}
      clickOutsideToClose={!busy}
    >
      <form
        onSubmit={submit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minWidth: 380,
        }}
      >
        <TextField
          label={t("ra_emulators_username")}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
        />
        <TextField
          label={t("ra_emulators_password")}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button
            type="button"
            theme="outline"
            onClick={onClose}
            disabled={busy}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? t("ra_emulators_working") : t("ra_emulators_submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
