import { nativeImage } from "electron";
import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";
import { db, levelKeys } from "@main/level";
import { generateAchievementCustomNotificationTest } from "@shared";
import type { UserPreferences } from "@types";
import { t } from "i18next";
import achievementPlaceholderIconPath from "@resources/achievement-icon-placeholder.png?asset";

const testIconUrl = nativeImage
  .createFromPath(achievementPlaceholderIconPath)
  .toDataURL();

const showAchievementTestNotification = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );
  const language = userPreferences.language ?? "en";
  const position =
    userPreferences.achievementCustomNotificationPosition ?? "top-left";
  const testAchievements = [
    generateAchievementCustomNotificationTest(t, language, testIconUrl, {
      globalUnlockPercent: 65,
    }),
    generateAchievementCustomNotificationTest(t, language, testIconUrl, {
      globalUnlockPercent: 25,
    }),
    generateAchievementCustomNotificationTest(t, language, testIconUrl, {
      globalUnlockPercent: 5,
      isHidden: true,
    }),
    generateAchievementCustomNotificationTest(t, language, testIconUrl, {
      isPlatinum: true,
    }),
  ];

  if (process.platform === "linux") {
    WindowManager.sendAchievementToFocusedWindow(position, testAchievements);
    return;
  }

  if (process.platform === "win32") {
    achievementNotificationPresenter.enqueueAchievements(
      position,
      testAchievements
    );
  }
};

registerEvent(
  "showAchievementTestNotification",
  showAchievementTestNotification
);
