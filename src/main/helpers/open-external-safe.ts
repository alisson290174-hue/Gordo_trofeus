import { shell } from "electron";
import { logger } from "@main/services/logger";

/**
 * The only way the renderer may open something outside the app. Windows protocol handlers
 * (file:, search-ms:, ms-msdt:, …) have been used for code execution, so only these schemes pass.
 */
const ALLOWED_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "steam:",
  "com.epicgames.launcher:",
]);

export const isSafeExternalUrl = (raw: string): boolean => {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    return false;
  }
};

export async function openExternalSafe(raw: string): Promise<void> {
  if (typeof raw !== "string" || !isSafeExternalUrl(raw)) {
    logger.warn(`[open-external] blocked non-allowed URL scheme: ${String(raw).slice(0, 40)}`);
    return;
  }
  await shell.openExternal(raw);
}
