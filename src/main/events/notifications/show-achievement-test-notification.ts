import { nativeImage } from "electron";
import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";
import { db, levelKeys } from "@main/level";
import { generateAchievementCustomNotificationTest, getAchievementTier } from "@shared";
import type { UserPreferences } from "@types";
import { t } from "i18next";
import bronzeIconPath from "@resources/achievement-icon-placeholder-bronze.png?asset";
import silverIconPath from "@resources/achievement-icon-placeholder-silver.png?asset";
import goldIconPath from "@resources/achievement-icon-placeholder-gold.png?asset";
import platinumIconPath from "@resources/achievement-icon-placeholder-platinum.png?asset";

const TIER_ICON_URLS = {
  bronze: nativeImage.createFromPath(bronzeIconPath).toDataURL(),
  silver: nativeImage.createFromPath(silverIconPath).toDataURL(),
  gold: nativeImage.createFromPath(goldIconPath).toDataURL(),
  platinum: nativeImage.createFromPath(platinumIconPath).toDataURL(),
};

const getTierIconUrl = (isPlatinum: boolean, globalUnlockPercent: number | null) =>
  TIER_ICON_URLS[getAchievementTier({ isPlatinum, globalUnlockPercent })];

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
    generateAchievementCustomNotificationTest(
      t,
      language,
      getTierIconUrl(false, 65),
      { globalUnlockPercent: 65 }
    ),
    generateAchievementCustomNotificationTest(
      t,
      language,
      getTierIconUrl(false, 25),
      { globalUnlockPercent: 25 }
    ),
    generateAchievementCustomNotificationTest(
      t,
      language,
      getTierIconUrl(false, 5),
      { globalUnlockPercent: 5, isHidden: true }
    ),
    generateAchievementCustomNotificationTest(
      t,
      language,
      getTierIconUrl(true, null),
      { isPlatinum: true }
    ),
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
