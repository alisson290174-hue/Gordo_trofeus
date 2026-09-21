export type AchievementTier = "platinum" | "gold" | "silver" | "bronze";

// Mirrors the cutoffs Steam's own community/tools treat as "rare" (~10%) and "uncommon" (~40%)
// global unlock rate. Unknown rarity (no data yet) defaults to bronze rather than guessing rare.
const GOLD_MAX_GLOBAL_PERCENT = 10;
const SILVER_MAX_GLOBAL_PERCENT = 40;

interface AchievementTierInput {
  isPlatinum: boolean;
  globalUnlockPercent: number | null | undefined;
}

export const getAchievementTier = ({
  isPlatinum,
  globalUnlockPercent,
}: AchievementTierInput): AchievementTier => {
  if (isPlatinum) return "platinum";
  if (globalUnlockPercent == null) return "bronze";
  if (globalUnlockPercent < GOLD_MAX_GLOBAL_PERCENT) return "gold";
  if (globalUnlockPercent < SILVER_MAX_GLOBAL_PERCENT) return "silver";
  return "bronze";
};
