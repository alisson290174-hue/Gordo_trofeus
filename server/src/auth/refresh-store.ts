import { db } from "../db.js";
import { REFRESH_TOKEN_TTL_DAYS } from "./jwt.js";

const insertStatement = db.prepare(
  `INSERT INTO refresh_tokens (token_hash, user_id, created_at, expires_at)
   VALUES (?, ?, ?, ?)`
);
const findValidStatement = db.prepare(
  `SELECT user_id FROM refresh_tokens
   WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`
);
const revokeStatement = db.prepare(
  "UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?"
);

export function storeRefreshToken(tokenHash: string, userId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  insertStatement.run(tokenHash, userId, now.toISOString(), expiresAt.toISOString());
}

/** Returns the owning user id if the (hashed) refresh token is valid and not expired/revoked. */
export function resolveRefreshToken(tokenHash: string): string | null {
  const row = findValidStatement.get(tokenHash, new Date().toISOString()) as
    | { user_id: string }
    | undefined;
  return row?.user_id ?? null;
}

export function revokeRefreshToken(tokenHash: string) {
  revokeStatement.run(new Date().toISOString(), tokenHash);
}
