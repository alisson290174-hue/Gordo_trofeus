import { app, safeStorage } from "electron";
import { execFile, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";

/**
 * Epic Games integration through Legendary (https://github.com/legendary-gl/legendary, GPL-3.0),
 * shipped unmodified in binaries/legendary and only executed as a separate program.
 *
 * Security:
 * - The binary is pinned: its SHA-256 must match the official 0.21.1 release before it runs.
 * - Its config and the Epic session live in the Opus user folder (LEGENDARY_CONFIG_PATH),
 *   never in a shared location and never sent to our server.
 * - Its own update checks are disabled, so it only talks to Epic.
 * - The Epic session (Legendary's user.json, with the account tokens) is kept encrypted at rest
 *   with Windows DPAPI (safeStorage), like Opus's own session: it is decrypted only while a
 *   Legendary process runs and sealed again — with any refreshed token — when the last one ends.
 */
const LEGENDARY_VERSION = "0.21.1";
const LEGENDARY_SHA256 =
  "6be77857dc0a6dd33ea7442ce8b5291944ec6da53757f81ca95b57ce794baf5b";

const binaryPath = app.isPackaged
  ? path.join(process.resourcesPath, "legendary", "legendary.exe")
  : path.join(__dirname, "..", "..", "binaries", "legendary", "legendary.exe");

export const legendaryConfigPath = () =>
  path.join(app.getPath("userData"), "legendary");

let verified: Promise<void> | null = null;

const verifyBinary = () => {
  verified ??= new Promise<void>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(binaryPath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => {
        const digest = hash.digest("hex");
        if (digest === LEGENDARY_SHA256) return resolve();
        reject(
          new Error(`legendary.exe failed integrity check (sha256 ${digest})`)
        );
      });
  }).catch((error) => {
    verified = null;
    throw error;
  });
  return verified;
};

const ensureConfig = () => {
  const dir = legendaryConfigPath();
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, "config.ini");
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      "[Legendary]\ndisable_update_check = true\ndisable_update_notice = true\n"
    );
  }
};

// --- Epic session at rest -------------------------------------------------------------------
const sessionFile = () => path.join(legendaryConfigPath(), "user.json");
const sealedFile = () => path.join(legendaryConfigPath(), "user.json.enc");
let openSessions = 0;

const canEncrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

/** Encrypts user.json into user.json.enc and removes the plaintext (or drops a stale seal). */
function sealSession() {
  if (!canEncrypt()) return;
  try {
    if (fs.existsSync(sessionFile())) {
      const sealed = safeStorage.encryptString(fs.readFileSync(sessionFile(), "utf8"));
      const temp = `${sealedFile()}.tmp`;
      fs.writeFileSync(temp, sealed, { mode: 0o600 });
      fs.renameSync(temp, sealedFile());
      fs.rmSync(sessionFile(), { force: true });
    } else {
      // Legendary removed the session (logout): the sealed copy must go too.
      fs.rmSync(sealedFile(), { force: true });
    }
  } catch (error) {
    logger.error("[legendary] could not seal the Epic session", error);
  }
}

/** Writes user.json back from the sealed copy for a Legendary run. */
function unsealSession() {
  if (!canEncrypt() || fs.existsSync(sessionFile()) || !fs.existsSync(sealedFile())) return;
  try {
    const plain = safeStorage.decryptString(fs.readFileSync(sealedFile()));
    fs.writeFileSync(sessionFile(), plain, { mode: 0o600 });
  } catch (error) {
    logger.error("[legendary] could not open the sealed Epic session", error);
  }
}

/** Marks the start of a Legendary run; the session stays readable until every run has ended. */
export function openEpicSession() {
  ensureConfig();
  if (openSessions === 0) unsealSession();
  openSessions += 1;
}

export function closeEpicSession() {
  openSessions = Math.max(0, openSessions - 1);
  if (openSessions === 0) sealSession();
}

/** For long-running Legendary children (install, launch): close the session when it exits. */
export function trackEpicSession(child: ChildProcess) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closeEpicSession();
  };
  child.once("exit", close);
  child.once("error", close);
}

/** At start-up: a session left in plaintext (app closed mid-run) is sealed right away. */
export function sealEpicSessionAtRest() {
  if (openSessions === 0) sealSession();
}

export interface LegendaryResult {
  stdout: string;
  stderr: string;
}

/** Runs Legendary with the given arguments (no shell, fixed binary, private config folder). */
export async function runLegendary(
  args: string[],
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {}
): Promise<LegendaryResult> {
  await verifyBinary();
  openEpicSession();

  return new Promise<LegendaryResult>((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          LEGENDARY_CONFIG_PATH: legendaryConfigPath(),
          PYTHONIOENCODING: "utf-8",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          // Never log arguments: `auth --code` carries a one-time login code.
          logger.error(
            `[legendary] "${args[0]}" failed: ${stderr.split("\n").slice(-3).join(" ").trim()}`
          );
          return reject(error);
        }
        resolve({ stdout, stderr });
      }
    );
  }).finally(closeEpicSession);
}

export const legendaryInfo = () => ({
  version: LEGENDARY_VERSION,
  binaryPath,
});
