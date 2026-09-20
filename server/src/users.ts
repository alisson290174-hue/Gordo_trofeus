import crypto from "node:crypto";
import { db } from "./db.js";

export interface UserRow {
  id: string;
  steam_id: string;
  username: string;
  display_name: string;
  email: string | null;
  profile_image_url: string | null;
  background_image_url: string | null;
  profile_visibility: "PUBLIC" | "PRIVATE" | "FRIENDS";
  souvenirs_visibility: "PUBLIC" | "PRIVATE" | "FRIENDS";
  allow_cloud_gifts: number;
  bio: string;
  karma: number;
  backups_per_game_limit: number;
  created_at: string;
  updated_at: string;
}

const findBySteamId = db.prepare("SELECT * FROM users WHERE steam_id = ?");
const findById = db.prepare("SELECT * FROM users WHERE id = ?");
const insertUser = db.prepare(
  `INSERT INTO users (id, steam_id, username, display_name, profile_image_url, created_at, updated_at)
   VALUES ($id, $steamId, $username, $displayName, $profileImageUrl, $now, $now)`
);

export function getUserBySteamId(steamId: string): UserRow | undefined {
  return findBySteamId.get(steamId) as UserRow | undefined;
}

export function getUserById(id: string): UserRow | undefined {
  return findById.get(id) as UserRow | undefined;
}

/** Upsert semantics for login: creates the user on first login, otherwise returns the existing row untouched. */
export function upsertUserFromSteamLogin(
  steamId: string,
  personaName: string | null,
  avatarUrl: string | null
): UserRow {
  const existing = getUserBySteamId(steamId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  insertUser.run({
    id,
    steamId,
    username: personaName ?? steamId,
    displayName: personaName ?? steamId,
    profileImageUrl: avatarUrl,
    now,
  });
  return getUserById(id)!;
}

export interface ProfileUpdate {
  displayName?: string;
  profileVisibility?: "PUBLIC" | "PRIVATE" | "FRIENDS";
  souvenirsVisibility?: "PUBLIC" | "PRIVATE" | "FRIENDS";
  profileImageUrl?: string;
  backgroundImageUrl?: string;
  bio?: string;
  allowCloudGifts?: boolean;
}

const updateStatement = db.prepare(`
  UPDATE users SET
    display_name = COALESCE($displayName, display_name),
    profile_visibility = COALESCE($profileVisibility, profile_visibility),
    souvenirs_visibility = COALESCE($souvenirsVisibility, souvenirs_visibility),
    profile_image_url = COALESCE($profileImageUrl, profile_image_url),
    background_image_url = COALESCE($backgroundImageUrl, background_image_url),
    bio = COALESCE($bio, bio),
    allow_cloud_gifts = COALESCE($allowCloudGifts, allow_cloud_gifts),
    updated_at = $updatedAt
  WHERE id = $id
`);

export function updateUserProfile(id: string, update: ProfileUpdate): UserRow {
  updateStatement.run({
    id,
    displayName: update.displayName ?? null,
    profileVisibility: update.profileVisibility ?? null,
    souvenirsVisibility: update.souvenirsVisibility ?? null,
    profileImageUrl: update.profileImageUrl ?? null,
    backgroundImageUrl: update.backgroundImageUrl ?? null,
    bio: update.bio ?? null,
    allowCloudGifts:
      update.allowCloudGifts === undefined ? null : update.allowCloudGifts ? 1 : 0,
    updatedAt: new Date().toISOString(),
  });
  return getUserById(id)!;
}

const FAR_FUTURE_EXPIRY = "2099-01-01T00:00:00.000Z";

/** Matches the client's `UserDetails` shape exactly (src/types/index.ts in the Hydra client repo). */
export function toUserDetails(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    backgroundImageUrl: user.background_image_url,
    profileVisibility: user.profile_visibility,
    allowCloudGifts: Boolean(user.allow_cloud_gifts),
    souvenirsVisibility: user.souvenirs_visibility,
    bio: user.bio,
    workwondersJwt: "",
    subscription: {
      id: "friends-tier",
      status: "active",
      plan: { id: "friends", name: "Friends" },
      expiresAt: FAR_FUTURE_EXPIRY,
      paymentMethod: "pix",
    },
    karma: user.karma,
    quirks: { backupsPerGameLimit: user.backups_per_game_limit },
  };
}
