import { app, type Session, type WebContents } from "electron";
import { logger } from "@main/services/logger";
import { openExternalSafe } from "./open-external-safe";
import { isDeepLink } from "./deep-link";

/**
 * App-wide Electron hardening, applied to every session and web contents as they are created:
 *
 * - Permissions: web permission prompts (camera, mic, location, notifications, MIDI, HID…) are
 *   denied by default. The app captures screenshots from the main process (desktopCapturer), so
 *   it never needs them; only harmless ones are allowed. Linux game capture keeps "media".
 * - Navigation: a window showing the app (file:// or the dev server) can never be navigated to a
 *   remote site — that page would get the preload bridge. Such links open in the browser instead.
 *   Windows that show remote pages by design (Steam / Epic sign-in) start remote and are untouched.
 */
const ALLOWED_PERMISSIONS = new Set<string>([
  "clipboard-sanitized-write",
  "fullscreen",
  ...(process.platform === "linux" ? ["media"] : []),
]);

const isAppUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    if (url.protocol === "file:") return true;
    const devServer = process.env.ELECTRON_RENDERER_URL;
    return Boolean(devServer && raw.startsWith(devServer));
  } catch {
    return false;
  }
};

function hardenSession(session: Session) {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission);
    if (!allowed)
      logger.info(`[hardening] denied permission request: ${permission}`);
    callback(allowed);
  });
  session.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  );
}

function hardenContents(contents: WebContents) {
  contents.on("will-navigate", (event, targetUrl) => {
    const current = contents.getURL();
    // Only guard app pages; sign-in windows navigate across remote pages by design.
    if (!current || !isAppUrl(current) || isAppUrl(targetUrl)) return;
    // Opus deep links (opuslauncher://, legacy hydralauncher://) are handled by their own listeners.
    if (isDeepLink(targetUrl)) return;
    event.preventDefault();
    void openExternalSafe(targetUrl);
  });

  // Never allow <webview> tags to be attached.
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

export function applyElectronHardening() {
  app.on("session-created", hardenSession);
  app.on("web-contents-created", (_event, contents) =>
    hardenContents(contents)
  );
  app.whenReady().then(() => {
    // The default session already exists by the time hooks are registered.
    void import("electron").then(({ session }) =>
      hardenSession(session.defaultSession)
    );
  });
}
