import { BrowserWindow, session } from "electron";
import type { EpicGame, EpicStatus } from "@types";
import { logger } from "../logger";
import { runLegendary } from "./legendary";

/**
 * Epic account: login through Epic's own page, status, logout and the owned-games list.
 * The login window runs in a throwaway, isolated session (no preload, no Node, sandboxed): the
 * user types the password into epicgames.com only, and all we read is the one-time
 * authorizationCode Epic returns, which goes straight to Legendary and is never stored or logged.
 */
const EPIC_CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a"; // Epic Games Launcher, as used by Legendary
const REDIRECT_URL = `https://www.epicgames.com/id/api/redirect?clientId=${EPIC_CLIENT_ID}&responseType=code`;
const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(REDIRECT_URL)}`;
const LOGIN_PARTITION = "epic-login"; // no "persist:" prefix → memory only, gone on close

const ALLOWED_HOSTS = [
  "epicgames.com",
  "unrealengine.com",
  // Social logins Epic offers on its page.
  "google.com",
  "gstatic.com",
  "googleusercontent.com",
  "apple.com",
  "facebook.com",
  "xbox.com",
  "live.com",
  "microsoftonline.com",
  "playstation.com",
  "sonyentertainmentnetwork.com",
  "steampowered.com",
  "steamcommunity.com",
  "nintendo.com",
  "hcaptcha.com",
  "arkoselabs.com",
];

const isAllowedUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
};

/** Local-only status (reads Legendary's private files, no network). */
export async function getEpicStatus(): Promise<EpicStatus> {
  try {
    const { stdout } = await runLegendary(["status", "--offline", "--json"], {
      timeoutMs: 30_000,
    });
    const data = JSON.parse(stdout) as {
      account: string;
      games_available: number;
      games_installed: number;
    };
    const connected =
      Boolean(data.account) && data.account !== "<not logged in>";
    return {
      connected,
      displayName: connected ? data.account : null,
      gamesAvailable: connected ? data.games_available : null,
      gamesInstalled: connected ? data.games_installed : null,
    };
  } catch (error) {
    logger.error("[epic] status failed", error);
    return {
      connected: false,
      displayName: null,
      gamesAvailable: null,
      gamesInstalled: null,
    };
  }
}

/** Opens Epic's login page; resolves true once Legendary accepted the login. */
export function loginToEpic(parent: BrowserWindow | null): Promise<boolean> {
  return new Promise((resolve) => {
    const loginSession = session.fromPartition(LOGIN_PARTITION);

    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      autoHideMenuBar: true,
      title: "Entrar com a Epic Games",
      backgroundColor: "#0b0f1a",
      webPreferences: {
        session: loginSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    let settled = false;
    const finish = async (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.close();
      // Nothing from the login page survives: cookies, storage and cache are wiped.
      await loginSession.clearStorageData().catch(() => {});
      await loginSession.clearCache().catch(() => {});
      resolve(ok);
    };

    // Popups (social login) stay inside the same isolated session, only for allowed hosts.
    win.webContents.setWindowOpenHandler(({ url }) =>
      isAllowedUrl(url)
        ? {
            action: "allow",
            overrideBrowserWindowOptions: {
              autoHideMenuBar: true,
              webPreferences: {
                session: loginSession,
                sandbox: true,
                contextIsolation: true,
              },
            },
          }
        : { action: "deny" }
    );
    win.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedUrl(url)) event.preventDefault();
    });

    win.webContents.on("did-finish-load", async () => {
      const current = win.webContents.getURL();
      if (!current.startsWith("https://www.epicgames.com/id/api/redirect"))
        return;

      try {
        const body = await win.webContents.executeJavaScript(
          "document.body ? document.body.innerText : ''",
          true
        );
        const { authorizationCode } = JSON.parse(String(body)) as {
          authorizationCode?: string | null;
        };
        if (!authorizationCode) {
          // Not logged in yet: Epic shows the redirect JSON with a null code — back to login.
          win.loadURL(LOGIN_URL);
          return;
        }
        await runLegendary(["auth", "--code", authorizationCode], {
          timeoutMs: 60_000,
        });
        logger.info("[epic] account connected");
        await finish(true);
      } catch (error) {
        logger.error("[epic] login failed", error);
        await finish(false);
      }
    });

    win.on("closed", () => void finish(false));
    win.loadURL(LOGIN_URL);
  });
}

export async function logoutFromEpic(): Promise<void> {
  await runLegendary(["auth", "--delete"], { timeoutMs: 30_000 });
  logger.info("[epic] account disconnected");
}

interface LegendaryListEntry {
  app_name: string;
  app_title: string;
  metadata?: {
    keyImages?: { type: string; url: string }[];
    categories?: { path: string }[];
  };
  dlcs?: unknown[];
}

const imageOf = (entry: LegendaryListEntry, types: string[]) => {
  for (const type of types) {
    const found = entry.metadata?.keyImages?.find(
      (image) => image.type === type
    );
    if (found?.url) return found.url;
  }
  return null;
};

/** Owned games (talks to Epic through Legendary) with installed flag. */
export async function listEpicGames(): Promise<EpicGame[]> {
  const [list, installed] = await Promise.all([
    runLegendary(["list", "--json"], { timeoutMs: 180_000 }),
    runLegendary(["list-installed", "--json"], { timeoutMs: 60_000 }),
  ]);

  const owned = JSON.parse(list.stdout) as LegendaryListEntry[];
  const installedNames = new Set(
    (JSON.parse(installed.stdout) as { app_name: string }[]).map(
      (game) => game.app_name
    )
  );

  return owned.map((entry) => ({
    appName: entry.app_name,
    title: entry.app_title,
    installed: installedNames.has(entry.app_name),
    coverUrl: imageOf(entry, [
      "DieselGameBoxTall",
      "DieselGameBox",
      "Thumbnail",
    ]),
    wideUrl: imageOf(entry, [
      "DieselGameBox",
      "DieselGameBoxWide",
      "DieselGameBoxTall",
    ]),
    isDlc: Boolean(
      entry.metadata?.categories?.some((category) => category.path === "addons")
    ),
  }));
}
