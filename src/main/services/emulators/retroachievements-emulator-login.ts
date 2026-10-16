import fs from "node:fs";
import path from "node:path";
import { net, safeStorage } from "electron";

import { db } from "@main/level";
import { logger } from "../logger";
import { getRetroArchConfig } from "../retroarch/retroarch-repository";
import { getIniLine, setIniValue } from "./duckstation-souvenir-config-value";
import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";
import { dolphinUserDirectoryCandidates } from "./emulator-log-paths";
import { getEmulatorConfig } from "./emulators-repository";
import { ppssppConfigCandidates } from "./ppsspp-paths";

/**
 * Signs every emulator that supports RetroAchievements into the user's account in one go. The
 * password goes straight to retroachievements.org (HTTPS, official login endpoint the emulators
 * themselves use) and is never stored or logged: only the session token it returns is written
 * into each emulator's own settings, exactly where its "Login" screen would put it.
 *
 * The token is also kept (encrypted with Windows DPAPI) so a reinstalled or newly added emulator
 * is signed in again at startup without asking; and while there is no token, emulators that have
 * achievements switched on without an account are switched off, so they stop asking for a login
 * every time a game starts.
 */

export type RaEmulatorLoginResult =
  | { ok: true; configured: string[] }
  | { ok: false; reason: "invalid_credentials" | "network" };

interface RaSession {
  user: string;
  token: string;
}

const SESSION_KEY = "opus:raEmulatorSession";

const saveSession = async (session: RaSession) => {
  if (!safeStorage.isEncryptionAvailable()) return;
  const enc = safeStorage
    .encryptString(JSON.stringify(session))
    .toString("base64");
  await db.put<string, { enc: string }>(
    SESSION_KEY,
    { enc },
    { valueEncoding: "json" }
  );
};

const readSession = async (): Promise<RaSession | null> => {
  const stored = await db
    .get<string, { enc: string }>(SESSION_KEY, { valueEncoding: "json" })
    .catch(() => null);
  if (!stored?.enc) return null;
  try {
    return JSON.parse(
      safeStorage.decryptString(Buffer.from(stored.enc, "base64"))
    ) as RaSession;
  } catch {
    return null;
  }
};

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

const iniValue = (file: string, section: string, key: string) => {
  if (!fs.existsSync(file)) return "";
  const line = getIniLine(fs.readFileSync(file, "utf8"), section, key);
  return line ? line.slice(line.indexOf("=") + 1).trim() : "";
};

const setCfg = (content: string, key: string, value: string) => {
  const line = `${key} = "${value}"`;
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  return re.test(content)
    ? content.replace(re, line)
    : `${content.trimEnd()}${content ? "\n" : ""}${line}\n`;
};

const cfgValue = (content: string, key: string) =>
  new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, "m").exec(content)?.[1] ??
  "";

interface EmulatorFiles {
  retroArchCfg: string | null;
  duckstationIni: string | null;
  pcsx2Ini: string | null;
  dolphinIni: string | null;
  ppssppIni: string | null;
}

const emulatorFiles = async (): Promise<EmulatorFiles> => {
  const retroArch = await getRetroArchConfig();
  const pcsx2 = await getEmulatorConfig("ps2");
  const dolphin = await getEmulatorConfig("dolphin");
  const psp = await getEmulatorConfig("psp");
  const dolphinDir = dolphin.executablePath
    ? dolphinUserDirectoryCandidates(dolphin.executablePath)[0]
    : null;
  return {
    retroArchCfg: retroArch.executablePath
      ? path.join(path.dirname(retroArch.executablePath), "retroarch.cfg")
      : null,
    duckstationIni:
      findExistingConfig(duckstationConfigCandidates()) ??
      duckstationConfigCandidates()[0] ??
      null,
    pcsx2Ini: pcsx2.executablePath
      ? findExistingConfig(pcsx2ConfigCandidates(pcsx2.executablePath))
      : null,
    dolphinIni: dolphinDir
      ? path.join(dolphinDir, "Config", "RetroAchievements.ini")
      : null,
    ppssppIni: psp.executablePath
      ? findExistingConfig(ppssppConfigCandidates(psp.executablePath))
      : null,
  };
};

const ppssppTokenFile = (ini: string) =>
  path.join(path.dirname(ini), "ppsspp_retroachievements.dat");

const writeSessionToEmulators = async ({
  user,
  token,
}: RaSession): Promise<string[]> => {
  const files = await emulatorFiles();
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

  const { retroArchCfg, duckstationIni, pcsx2Ini, dolphinIni, ppssppIni } =
    files;
  if (retroArchCfg) {
    attempt("RetroArch", () => {
      let content = fs.existsSync(retroArchCfg)
        ? fs.readFileSync(retroArchCfg, "utf8")
        : "";
      content = setCfg(content, "cheevos_enable", "true");
      content = setCfg(content, "cheevos_username", user);
      content = setCfg(content, "cheevos_token", token);
      content = setCfg(content, "cheevos_password", "");
      fs.writeFileSync(retroArchCfg, content, "utf8");
    });
  }
  if (duckstationIni) {
    attempt("DuckStation (PS1)", () =>
      writeIni(duckstationIni, [
        ["Cheevos", "Enabled", "true"],
        ["Cheevos", "Username", user],
        ["Cheevos", "Token", token],
        ["Cheevos", "LoginTimestamp", now],
      ])
    );
  }
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
  if (dolphinIni) {
    attempt("Dolphin (GameCube/Wii)", () =>
      writeIni(dolphinIni, [
        ["Achievements", "Enabled", "True"],
        ["Achievements", "Username", user],
        ["Achievements", "ApiToken", token],
      ])
    );
  }
  if (ppssppIni) {
    attempt("PPSSPP (PSP)", () => {
      writeIni(ppssppIni, [
        ["Achievements", "AchievementsEnable", "True"],
        ["Achievements", "AchievementsUserName", user],
      ]);
      // PPSSPP keeps the token in its own file next to ppsspp.ini.
      fs.writeFileSync(ppssppTokenFile(ppssppIni), token, "utf8");
    });
  }
  return configured;
};

export const loginRetroAchievementsInEmulators = async (
  username: string,
  password: string
): Promise<RaEmulatorLoginResult> => {
  let session: RaSession | null;
  try {
    session = await loginForToken(username.trim(), password);
  } catch (error) {
    logger.warn("[ra-login] network error", String(error));
    return { ok: false, reason: "network" };
  }
  if (!session) return { ok: false, reason: "invalid_credentials" };

  await saveSession(session).catch((error) =>
    logger.warn("[ra-login] could not keep the session", String(error))
  );
  const configured = await writeSessionToEmulators(session);
  logger.info("[ra-login] emulators signed in", { configured });
  return { ok: true, configured };
};

/** Whether the emulators have been signed in through Opus (for the Emulação screen). */
export const hasRaEmulatorSession = async () => Boolean(await readSession());

const lacksSession = (files: EmulatorFiles) => {
  const { retroArchCfg, duckstationIni, pcsx2Ini, dolphinIni, ppssppIni } =
    files;
  return Boolean(
    (retroArchCfg &&
      fs.existsSync(retroArchCfg) &&
      !cfgValue(fs.readFileSync(retroArchCfg, "utf8"), "cheevos_token")) ||
      (duckstationIni && !iniValue(duckstationIni, "Cheevos", "Token")) ||
      (pcsx2Ini && !iniValue(pcsx2Ini, "Achievements", "Token")) ||
      (dolphinIni && !iniValue(dolphinIni, "Achievements", "ApiToken")) ||
      (ppssppIni && !fs.existsSync(ppssppTokenFile(ppssppIni)))
  );
};

/**
 * Startup: with a kept session, sign in any emulator that lost it (reinstall, new emulator);
 * without one, switch achievements off where they're on without an account.
 */
export const ensureRaEmulatorSessions = async () => {
  const files = await emulatorFiles();
  const session = await readSession();
  if (session) {
    if (lacksSession(files)) {
      const configured = await writeSessionToEmulators(session);
      logger.info("[ra-login] session restored in emulators", { configured });
    }
    return;
  }

  const quieted: string[] = [];
  const { retroArchCfg, duckstationIni, pcsx2Ini } = files;
  if (retroArchCfg && fs.existsSync(retroArchCfg)) {
    const content = fs.readFileSync(retroArchCfg, "utf8");
    if (
      cfgValue(content, "cheevos_enable") === "true" &&
      !cfgValue(content, "cheevos_token") &&
      !cfgValue(content, "cheevos_password")
    ) {
      fs.writeFileSync(
        retroArchCfg,
        setCfg(content, "cheevos_enable", "false"),
        "utf8"
      );
      quieted.push("RetroArch");
    }
  }
  if (
    duckstationIni &&
    iniValue(duckstationIni, "Cheevos", "Enabled").toLowerCase() === "true" &&
    !iniValue(duckstationIni, "Cheevos", "Token")
  ) {
    writeIni(duckstationIni, [["Cheevos", "Enabled", "false"]]);
    quieted.push("DuckStation");
  }
  if (
    pcsx2Ini &&
    iniValue(pcsx2Ini, "Achievements", "Enabled").toLowerCase() === "true" &&
    !iniValue(pcsx2Ini, "Achievements", "Token")
  ) {
    writeIni(pcsx2Ini, [["Achievements", "Enabled", "false"]]);
    quieted.push("PCSX2");
  }
  if (quieted.length)
    logger.info("[ra-login] no emulator login yet: achievements off in", {
      quieted,
    });
};
