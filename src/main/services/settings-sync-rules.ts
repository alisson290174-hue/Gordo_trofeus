/**
 * What of the user's setup travels to the server (and back after a reinstall). Pure rules, no I/O.
 * Secrets never leave the PC: API keys / tokens are stripped from the preferences.
 */

export const SETTINGS_SNAPSHOT_VERSION = 1;

const SECRET_KEY = /(api)?(key|token|password|secret|cookie)$/i;

export const stripSecrets = (
  preferences: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(preferences).filter(([key]) => !SECRET_KEY.test(key))
  );

export interface SyncedFolder {
  path: string;
  scanSubfolders: boolean;
}

export interface SyncedEmulator {
  executablePath: string | null;
  biosPath: string | null;
  romFolders: SyncedFolder[];
}

export interface SettingsSnapshot {
  version: number;
  preferences: Record<string, unknown>;
  emulatorsBaseDir: string | null;
  emulators: Record<string, SyncedEmulator>;
  retroarch: {
    executablePath: string | null;
    romFolders: SyncedFolder[];
  } | null;
}

/** A fresh install: no game folder linked anywhere yet. Only then is the server copy applied. */
export const looksLikeFreshInstall = (snapshot: SettingsSnapshot) =>
  Object.values(snapshot.emulators).every(
    (emulator) => emulator.romFolders.length === 0
  ) && (snapshot.retroarch?.romFolders.length ?? 0) === 0;

/**
 * Restored preferences: the server copy, with whatever the new install already holds for secrets
 * (and anything the server copy doesn't know about) kept local.
 */
export const mergePreferences = (
  local: Record<string, unknown>,
  remote: Record<string, unknown>
): Record<string, unknown> => ({ ...local, ...stripSecrets(remote) });
