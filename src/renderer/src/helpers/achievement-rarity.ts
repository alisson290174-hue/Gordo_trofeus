export type AchievementRarity = "ultra_rare" | "rare" | "uncommon" | "common";

// Finer-grained than the trophy tier (which only splits gold/silver/bronze): this is the label
// shown next to the global-unlock percentage, mirroring how PSN/Steam describe rarity. Unknown
// rarity (no data yet) reads as "common" rather than guessing rare.
export function getAchievementRarity(
  globalUnlockPercent?: number | null
): AchievementRarity {
  if (globalUnlockPercent == null) return "common";
  if (globalUnlockPercent < 5) return "ultra_rare";
  if (globalUnlockPercent < 10) return "rare";
  if (globalUnlockPercent < 40) return "uncommon";
  return "common";
}
