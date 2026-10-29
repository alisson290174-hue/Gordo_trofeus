import { sleep } from "@main/helpers";
import { gamesPlaytime, watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { UpdateManager } from "./update-manager";
import { INTERVALS } from "@main/constants";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import { logger } from "./logger";

const wrapInLoop = (
  fn: () => unknown,
  interval: number,
  name = "loop",
  maxRunMs?: number
) => {
  const loop = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        if (maxRunMs) {
          // A run that never settles would stop this watcher for good, silently. Give up on
          // waiting for it (it may still finish in the background) and keep the loop alive.
          let timer: NodeJS.Timeout | undefined;
          const timedOut = await Promise.race([
            Promise.resolve(fn()).then(() => false),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(true), maxRunMs);
            }),
          ]).finally(() => clearTimeout(timer));
          if (timedOut)
            logger.warn(
              `[main-loop] ${name} took over ${maxRunMs} ms; moving on`
            );
        } else {
          await fn();
        }
      } catch (error) {
        logger.error(
          `Error in loop: ${error instanceof Error ? error.stack : String(error)}`
        );
      }

      await sleep(interval);
    }
  };
  loop();
};

let mainLoopStarted = false;

export const startMainLoop = async () => {
  // Idempotent: startup also calls it as a safety net when loading state failed half-way.
  if (mainLoopStarted) return;
  mainLoopStarted = true;

  wrapInLoop(() => watchProcesses(), INTERVALS.processWatcher);
  wrapInLoop(
    () => AchievementWatcherManager.watchAchievements(),
    INTERVALS.achievementWatcher,
    "achievement watcher",
    60_000
  );
  wrapInLoop(() => UpdateManager.checkForUpdates(), INTERVALS.updateChecker);

  wrapInLoop(() => {
    PowerSaveBlockerManager.syncState({
      downloadActive: false,
      compatibilityGameActive:
        PowerSaveBlockerManager.hasRunningCompatibilityGame(
          gamesPlaytime.keys()
        ),
    });
  }, INTERVALS.powerSaveBlockerSync);
};
