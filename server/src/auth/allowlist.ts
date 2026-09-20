import { db } from "../db.js";

const isAllowedStatement = db.prepare(
  "SELECT 1 FROM allowed_steam_ids WHERE steam_id = ?"
);
const isExistingUserStatement = db.prepare(
  "SELECT 1 FROM users WHERE steam_id = ?"
);

/** Invite-only login: an already-registered user may always return; anyone else must be on the allowlist. */
export function isSteamIdAllowedToLogin(steamId: string): boolean {
  return Boolean(isExistingUserStatement.get(steamId) || isAllowedStatement.get(steamId));
}
