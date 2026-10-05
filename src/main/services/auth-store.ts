import { safeStorage } from "electron";
import type { Auth } from "@types";
import { db, levelKeys } from "@main/level";
import { logger } from "./logger";

/**
 * Opus login (access + 60-day refresh token) at rest, encrypted with Windows DPAPI through
 * Electron safeStorage: a copy of the app's data folder is useless on another Windows account or
 * machine. Records saved before this existed (plain JSON) are read once and re-saved encrypted.
 */
interface EncryptedAuth {
  v: 2;
  enc: string;
}

const isEncrypted = (value: unknown): value is EncryptedAuth =>
  Boolean(value) &&
  (value as EncryptedAuth).v === 2 &&
  typeof (value as EncryptedAuth).enc === "string";

export async function writeAuth(auth: Auth): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn(
      "[auth-store] OS encryption unavailable; storing session unencrypted"
    );
    await db.put<string, Auth>(levelKeys.auth, auth, { valueEncoding: "json" });
    return;
  }
  const enc = safeStorage
    .encryptString(JSON.stringify(auth))
    .toString("base64");
  await db.put<string, EncryptedAuth>(
    levelKeys.auth,
    { v: 2, enc },
    { valueEncoding: "json" }
  );
}

export async function readAuth(): Promise<Auth | null> {
  const stored = await db
    .get<string, Auth | EncryptedAuth>(levelKeys.auth, {
      valueEncoding: "json",
    })
    .catch(() => null);
  if (!stored) return null;

  if (isEncrypted(stored)) {
    try {
      return JSON.parse(
        safeStorage.decryptString(Buffer.from(stored.enc, "base64"))
      ) as Auth;
    } catch (error) {
      // Different Windows user / machine: the session can't be used here — sign in again.
      logger.error("[auth-store] could not decrypt stored session", error);
      return null;
    }
  }

  // Legacy plain record: migrate in place.
  const legacy = stored as Auth;
  if (legacy.accessToken || legacy.refreshToken)
    await writeAuth(legacy).catch(() => {});
  return legacy;
}
