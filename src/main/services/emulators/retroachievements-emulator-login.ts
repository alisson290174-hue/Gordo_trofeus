import fs from "node:fs";
import path from "node:path";
import { net } from "electron";

import { logger } from "../logger";
import { getRetroArchConfig } from "../retroarch/retroarch-repository";
import { setIniValue } from "./duckstation-souvenir-config-value";
import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";
import { dolphinUserDirectoryCandidates } from "./emulator-log-paths";
import { getEmulatorConfig } from "./emulators-repository";

/**
 * Signs every emulator that supports RetroAchievements into the user's account in one go. The
 * password goes straight to retroachievements.org (HTTPS, official login endpoint the emulators
 * themselves use) and is never stored or logged: only the session token it returns is written
 * into each emulator's own settings, exactly where its "Login" screen would put it.
 */

export type RaEmulatorLoginResult =
  | { ok: true; configured: string[] }
  | { ok: false; reason: "invalid_credentials" | "network" };

const loginForToken = async (username: string, password: string) => {
  const body = new URLSearchParams({ r: "login2", u: username, p: password });
  const response = await net.fetch(
    "https://retroachievements.org/dorequest.php",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "OpusLauncher",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    }
  );
  const data = (await response.json().catch(() => null)) as {
    Success?: boolean;
    User?: string;
    Token?: string;
  } | null;
  if (!data?.Success || !data.Token) return null;
  return { user: data.User ?? username, token: data.Token };
};

const writeIni = (file: string, entries: [string, string, string][]) => {
  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  let next = content;
  for (const [section, key, value] of entries)
    next = setIniValue(next, section, key, value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, "utf8");
};

const setCfg = (content: string, key: string, value: string) => {
  const line = `${key} = "${value}"`;
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  return re.test(content)
    ? content.replace(re, line)
    : `${content.trimEnd()}${content ? "\n" : ""}${line}\n`;
};

export const loginRetroAchievementsInEmulators = async (
  username: string,
  password: string
): Promise<RaEmulatorLoginResult> => {
  let session: { user: string; token: string } | null;
  try {
    session = await loginForToken(username.trim(), password);
  } catch (error) {
    logger.warn("[ra-login] network error", String(error));
    return { ok: false, reason: "network" };
  }
  if (!session) return { ok: false, reason: "invalid_credentials" };

  const { user, token } = session;
  const now = String(Math.floor(Date.now() / 1000));
  const configured: string[] = [];
  const attempt = (name: string, run: () => void) => {
    try {
      run();
      configured.push(name);
    } catch (error) {
      logger.warn(`[ra-login] could not configure ${name}`, String(error));
    }
  };

  const retroArch = await getRetroArchConfig();
  if (retroArch.executablePath) {
    attempt("RetroArch", () => {
      const file = path.join(
        path.dirname(retroArch.executablePath as string),
        "retroarch.cfg"
      );
      let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      content = setCfg(content, "cheevos_enable", "true");
      content = setCfg(content, "cheevos_username", user);
      content = setCfg(content, "cheevos_token", token);
      content = setCfg(content, "cheevos_password", "");
      fs.writeFileSync(file, content, "utf8");
    });
  }

  const duckstation =
    findExistingConfig(duckstationConfigCandidates()) ??
    duckstationConfigCandidates()[0];
  if (duckstation) {
    attempt("DuckStation (PS1)", () =>
      writeIni(duckstation, [
        ["Cheevos", "Enabled", "true"],
        ["Cheevos", "Username", user],
        ["Cheevos", "Token", token],
        ["Cheevos", "LoginTimestamp", now],
      ])
    );
  }

  const pcsx2 = await getEmulatorConfig("ps2");
  const pcsx2Ini = pcsx2.executablePath
    ? findExistingConfig(pcsx2ConfigCandidates(pcsx2.executablePath))
    : null;
  if (pcsx2Ini) {
    attempt("PCSX2 (PS2)", () =>
      writeIni(pcsx2Ini, [
        ["Achievements", "Enabled", "true"],
        ["Achievements", "Username", user],
        ["Achievements", "Token", token],
        ["Achievements", "LoginTimestamp", now],
      ])
    );
  }

  const dolphin = await getEmulatorConfig("dolphin");
  const dolphinDir = dolphin.executablePath
    ? dolphinUserDirectoryCandidates(dolphin.executablePath)[0]
    : null;
  if (dolphinDir) {
    attempt("Dolphin (GameCube/Wii)", () =>
      writeIni(path.join(dolphinDir, "Config", "RetroAchievements.ini"), [
        ["Achievements", "Enabled", "True"],
        ["Achievements", "Username", user],
        ["Achievements", "ApiToken", token],
      ])
    );
  }

  logger.info("[ra-login] emulators signed in", { configured });
  return { ok: true, configured };
};
