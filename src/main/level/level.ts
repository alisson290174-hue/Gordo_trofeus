import { levelDatabasePath } from "@main/constants";
import { ClassicLevel } from "classic-level";

export const db = new ClassicLevel(levelDatabasePath, {
  valueEncoding: "json",
});

const OPEN_ATTEMPTS = 40;
const OPEN_RETRY_MS = 500;

/**
 * Opens the database before anything reads it. LevelDB keeps an exclusive LOCK file, so when
 * Opus is reopened while the previous instance is still shutting down (or the dev build is
 * running) the first open fails; without this the app came up with no IPC handlers at all.
 * Waits up to ~20 s for the other process to let go.
 */
export const openDatabase = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.open();
      return;
    } catch (error) {
      if (attempt >= OPEN_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, OPEN_RETRY_MS));
    }
  }
};
