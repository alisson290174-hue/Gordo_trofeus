import { getAchievementTier } from "@shared";
import BronzeFallbackIconUrl from "@renderer/assets/icons/achievement-icon-placeholder-bronze.png";
import SilverFallbackIconUrl from "@renderer/assets/icons/achievement-icon-placeholder-silver.png";
import GoldFallbackIconUrl from "@renderer/assets/icons/achievement-icon-placeholder-gold.png";
import PlatinumFallbackIconUrl from "@renderer/assets/icons/achievement-icon-placeholder-platinum.png";

export const TIER_FALLBACK_ICON_URLS = {
  bronze: BronzeFallbackIconUrl,
  silver: SilverFallbackIconUrl,
  gold: GoldFallbackIconUrl,
  platinum: PlatinumFallbackIconUrl,
} as const;

/**
 * The placeholder shown when a real achievement icon (Steam CDN) can't be loaded.
 * Matches the rarity tier so a broken icon still reads as the right medal color,
 * defaulting to bronze for locked/unknown achievements.
 */
export const getTierFallbackIconUrl = (
  isPlatinum: boolean,
  globalUnlockPercent: number | null | undefined
) =>
  TIER_FALLBACK_ICON_URLS[
    getAchievementTier({
      isPlatinum,
      globalUnlockPercent: globalUnlockPercent ?? null,
    })
  ];
