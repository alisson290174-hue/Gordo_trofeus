import { db } from "./db.js";

const addKarmaStatement = db.prepare(
  "UPDATE users SET karma = karma + ?, updated_at = ? WHERE id = ?"
);

/** Fórmula própria e transparente (a oficial é fechada): +1 conquista, +5 platina, +1 curtida recebida. */
export const KARMA = {
  ACHIEVEMENT_UNLOCKED: 1,
  PLATINUM: 5,
  SOUVENIR_LIKED: 1,
} as const;

export function addKarma(userId: string, amount: number) {
  addKarmaStatement.run(amount, new Date().toISOString(), userId);
}
