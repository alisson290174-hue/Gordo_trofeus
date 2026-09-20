import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const dataDir = path.resolve(import.meta.dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "hydra.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Auth + perfil
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, steam_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL, display_name TEXT NOT NULL, email TEXT,
  profile_image_url TEXT, background_image_url TEXT,
  profile_visibility TEXT NOT NULL DEFAULT 'PUBLIC',
  souvenirs_visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  allow_cloud_gifts INTEGER NOT NULL DEFAULT 1,
  bio TEXT NOT NULL DEFAULT '', karma INTEGER NOT NULL DEFAULT 0,
  backups_per_game_limit INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS upload_tokens (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, max_bytes INTEGER NOT NULL, stored_path TEXT,
  created_at TEXT NOT NULL, consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS allowed_steam_ids (
  steam_id TEXT PRIMARY KEY, note TEXT, added_at TEXT NOT NULL
);

-- Catálogo / fontes de download
CREATE TABLE IF NOT EXISTS steam_games (
  appid INTEGER PRIMARY KEY, title TEXT NOT NULL,
  genres TEXT, developers TEXT, publishers TEXT,
  cover_url TEXT, hero_url TEXT, logo_url TEXT, release_year INTEGER,
  cached_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS download_sources (
  id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, name TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_MATCHING',
  download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game_repacks (
  id TEXT PRIMARY KEY, appid INTEGER NOT NULL REFERENCES steam_games(appid),
  title TEXT NOT NULL, file_size TEXT, uris TEXT NOT NULL,
  upload_date TEXT, download_source_id TEXT NOT NULL REFERENCES download_sources(id),
  created_at TEXT NOT NULL
);

-- Biblioteca sincronizada / conquistas
CREATE TABLE IF NOT EXISTS profile_games (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  shop TEXT NOT NULL, object_id TEXT NOT NULL,
  play_time_ms INTEGER NOT NULL DEFAULT 0, last_time_played TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE(user_id, shop, object_id)
);
CREATE TABLE IF NOT EXISTS achievement_catalogue (
  shop TEXT NOT NULL, object_id TEXT NOT NULL, name TEXT NOT NULL,
  display_name TEXT, description TEXT, icon TEXT, icongray TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, points INTEGER,
  retroachievements_game_id INTEGER, cached_at TEXT NOT NULL,
  PRIMARY KEY (shop, object_id, name)
);
CREATE TABLE IF NOT EXISTS user_achievements (
  profile_game_id TEXT NOT NULL REFERENCES profile_games(id),
  achievement_name TEXT NOT NULL, unlock_time INTEGER NOT NULL,
  hardcore_unlock_time INTEGER, source TEXT NOT NULL DEFAULT 'steam',
  souvenir_id TEXT REFERENCES souvenirs(id),
  PRIMARY KEY (profile_game_id, achievement_name)
);

-- Souvenirs
CREATE TABLE IF NOT EXISTS souvenirs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  profile_game_id TEXT NOT NULL REFERENCES profile_games(id),
  image_key TEXT NOT NULL, captured_at TEXT NOT NULL,
  primary_achievement_name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'PUBLIC', like_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS souvenir_achievements (
  souvenir_id TEXT NOT NULL REFERENCES souvenirs(id), achievement_name TEXT NOT NULL,
  PRIMARY KEY (souvenir_id, achievement_name)
);
CREATE TABLE IF NOT EXISTS souvenir_likes (
  souvenir_id TEXT NOT NULL REFERENCES souvenirs(id), user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (souvenir_id, user_id)
);
CREATE TABLE IF NOT EXISTS souvenir_reports (
  id TEXT PRIMARY KEY, souvenir_id TEXT NOT NULL REFERENCES souvenirs(id),
  reporter_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, description TEXT,
  created_at TEXT NOT NULL
);

-- Amigos / bloqueio
CREATE TABLE IF NOT EXISTS relations (
  a_id TEXT NOT NULL REFERENCES users(id), b_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id), blocked_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id)
);
`);

// Seed da allowlist a partir do .env — idempotente, roda a cada boot.
const seedAllowedSteamId = db.prepare(
  `INSERT INTO allowed_steam_ids (steam_id, note, added_at)
   VALUES (?, 'seed via .env', ?)
   ON CONFLICT(steam_id) DO NOTHING`
);
db.exec("BEGIN");
try {
  const now = new Date().toISOString();
  for (const steamId of config.allowedSteamIds) seedAllowedSteamId.run(steamId, now);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
