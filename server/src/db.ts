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
-- Fila de ingestão do catálogo completo da Steam (independente de fonte de download) — populada uma
-- vez a partir do GetAppList e processada aos poucos em segundo plano para respeitar o rate limit.
CREATE TABLE IF NOT EXISTS steam_appid_sync_queue (
  appid INTEGER PRIMARY KEY, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | skipped
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
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

-- Coleções de jogos (pastas que o usuário cria pra organizar a biblioteca)
CREATE TABLE IF NOT EXISTS game_collections (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game_collection_items (
  collection_id TEXT NOT NULL REFERENCES game_collections(id),
  profile_game_id TEXT NOT NULL REFERENCES profile_games(id),
  PRIMARY KEY (collection_id, profile_game_id)
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

-- Cloud save (v2, baseado em snapshots). Blobs content-addressed por sha256, deduplicados e
-- contados por referência: o mesmo save compartilhado entre versões/jogos guarda 1 arquivo só.
CREATE TABLE IF NOT EXISTS cloud_save_blobs (
  hash TEXT PRIMARY KEY, size_bytes INTEGER NOT NULL,
  stored_path TEXT NOT NULL, ref_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- Um único snapshot ativo por (usuário, jogo) — o cliente rejeita mais de um. O commit substitui
-- o anterior e incrementa a versão.
CREATE TABLE IF NOT EXISTS cloud_snapshots (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  shop TEXT NOT NULL, object_id TEXT NOT NULL,
  version INTEGER NOT NULL, snapshot_hash TEXT NOT NULL,
  platform TEXT, hostname TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id, shop, object_id)
);
CREATE TABLE IF NOT EXISTS cloud_snapshot_variants (
  snapshot_id TEXT NOT NULL REFERENCES cloud_snapshots(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL, kind TEXT NOT NULL,
  steam_id64 TEXT, concrete_folder_id TEXT,
  PRIMARY KEY (snapshot_id, variant_id)
);
CREATE TABLE IF NOT EXISTS cloud_snapshot_custom_paths (
  snapshot_id TEXT NOT NULL REFERENCES cloud_snapshots(id) ON DELETE CASCADE,
  raw_path TEXT NOT NULL, PRIMARY KEY (snapshot_id, raw_path)
);
CREATE TABLE IF NOT EXISTS cloud_snapshot_files (
  snapshot_id TEXT NOT NULL REFERENCES cloud_snapshots(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL, raw_path TEXT NOT NULL, relative_path TEXT NOT NULL,
  hash TEXT NOT NULL REFERENCES cloud_save_blobs(hash), size_bytes INTEGER NOT NULL,
  last_modified_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, variant_id, raw_path, relative_path)
);
-- Proposta de snapshot entre o prepare e o commit. Guarda o manifesto proposto (variants, files,
-- custom paths) como JSON até o commit publicar. Limpo por expiração.
CREATE TABLE IF NOT EXISTS cloud_pending_snapshots (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  shop TEXT NOT NULL, object_id TEXT NOT NULL,
  base_version INTEGER NOT NULL, snapshot_hash TEXT NOT NULL,
  platform TEXT, hostname TEXT, manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// Migração leve, idempotente — coluna adicionada após o deploy inicial. ALTER TABLE ADD COLUMN
// falha se a coluna já existir, então o catch cobre o caso "já migrado" sem checar antes.
try {
  db.exec("ALTER TABLE achievement_catalogue ADD COLUMN global_unlock_percent REAL");
} catch {
  // coluna já existe
}
// lang é NULL para linhas cacheadas antes do suporte a português — tratado como "precisa
// re-buscar" pelo código que lê essas tabelas, então não precisa de backfill aqui.
try {
  db.exec("ALTER TABLE steam_games ADD COLUMN lang TEXT");
} catch {
  // coluna já existe
}
try {
  db.exec("ALTER TABLE achievement_catalogue ADD COLUMN lang TEXT");
} catch {
  // coluna já existe
}
// Contagem de reviews da Steam (recommendations.total) — sinal de popularidade para ordenar o
// catálogo. NULL em linhas cacheadas antes desta coluna → tratado como "precisa re-buscar" e cai
// por último na ordenação por popularidade até ser preenchido.
try {
  db.exec("ALTER TABLE steam_games ADD COLUMN review_count INTEGER");
} catch {
  // coluna já existe
}
// Conquistas online/multiplayer: marcadas para serem escondidas do catálogo, de modo que a
// "platina" seja alcançável só com jogo offline (decisão deste servidor pessoal — jogos como
// GTA V/RDR2 têm troféus exclusivos de online que ninguém aqui vai fazer).
try {
  db.exec("ALTER TABLE achievement_catalogue ADD COLUMN is_online INTEGER NOT NULL DEFAULT 0");
} catch {
  // coluna já existe
}
// (Re)classifica a cada boot as que a Steam descreve como online/multiplayer — idempotente, só
// toca linhas ainda marcadas como offline. Cobre PT e EN. "GTA Online:"/"Red Dead Online:" são os
// prefixos que a própria Steam usa nesses jogos; multiplayer/multijogador/pvp cobrem os demais.
db.exec(`
  UPDATE achievement_catalogue SET is_online = 1
  WHERE is_online = 0 AND (
    LOWER(description) LIKE '%online%'
    OR LOWER(description) LIKE '%multiplayer%'
    OR LOWER(description) LIKE '%multijogador%'
    OR LOWER(description) LIKE '%pvp%'
    OR LOWER(display_name) LIKE '%multiplayer%'
    OR LOWER(display_name) LIKE '%online%'
  )
`);

// Integração RetroAchievements por usuário (credenciais validadas na Web API oficial).
db.exec(`
  CREATE TABLE IF NOT EXISTS retroachievements_integrations (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    web_api_key TEXT NOT NULL,
    ra_user_id TEXT,
    connected_at TEXT NOT NULL
  )
`);

// RetroAchievements: lista oficial de hashes por console (renovada semanalmente) e o vínculo
// jogo da biblioteca → jogo do RA, criado quando um hash de disco confere com a lista.
db.exec(`
  CREATE TABLE IF NOT EXISTS ra_game_hashes (
    hash TEXT PRIMARY KEY,
    ra_game_id INTEGER NOT NULL,
    title TEXT,
    console_id INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ra_hash_lists (
    console_id INTEGER PRIMARY KEY,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ra_game_links (
    shop TEXT NOT NULL,
    object_id TEXT NOT NULL,
    ra_game_id INTEGER NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (shop, object_id)
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

// Unlocks saved with a different letter case than the catalogue ("ACHIEVEMENT_1" vs
// "Achievement_1") never matched and didn't count. Rename them to the catalogue spelling; OR IGNORE
// leaves a row alone when the right spelling is already there. Idempotent — a no-op once fixed.
db.exec(`
  UPDATE OR IGNORE user_achievements
  SET achievement_name = (
    SELECT ac.name FROM achievement_catalogue ac
    JOIN profile_games pg ON pg.id = user_achievements.profile_game_id
    WHERE ac.shop = pg.shop AND ac.object_id = pg.object_id
      AND UPPER(ac.name) = UPPER(user_achievements.achievement_name)
    LIMIT 1
  )
  WHERE EXISTS (
    SELECT 1 FROM achievement_catalogue ac
    JOIN profile_games pg ON pg.id = user_achievements.profile_game_id
    WHERE ac.shop = pg.shop AND ac.object_id = pg.object_id
      AND UPPER(ac.name) = UPPER(user_achievements.achievement_name)
      AND ac.name <> user_achievements.achievement_name
  );
  -- What's left with the wrong spelling is a duplicate of a row that already has the right one.
  DELETE FROM user_achievements
  WHERE EXISTS (
    SELECT 1 FROM achievement_catalogue ac
    JOIN profile_games pg ON pg.id = user_achievements.profile_game_id
    WHERE ac.shop = pg.shop AND ac.object_id = pg.object_id
      AND UPPER(ac.name) = UPPER(user_achievements.achievement_name)
      AND ac.name <> user_achievements.achievement_name
  );
`);

// Indexes for the queries that actually run (audit 2026-09-30: the DB had none besides PKs).
// IF NOT EXISTS keeps boot idempotent; each one is created once, in the background of startup.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_appid_queue_status ON steam_appid_sync_queue(status);
  CREATE INDEX IF NOT EXISTS idx_steam_games_review_count ON steam_games(review_count);
  CREATE INDEX IF NOT EXISTS idx_profile_games_shop_object ON profile_games(shop, object_id);
  CREATE INDEX IF NOT EXISTS idx_relations_a ON relations(a_id, status);
  CREATE INDEX IF NOT EXISTS idx_relations_b ON relations(b_id, status);
  CREATE INDEX IF NOT EXISTS idx_souvenirs_user ON souvenirs(user_id, captured_at);
  CREATE INDEX IF NOT EXISTS idx_game_repacks_appid ON game_repacks(appid);
  CREATE INDEX IF NOT EXISTS idx_cloud_snapshots_user ON cloud_snapshots(user_id);
  CREATE INDEX IF NOT EXISTS idx_cloud_snapshot_files_snapshot ON cloud_snapshot_files(snapshot_id);
`);
