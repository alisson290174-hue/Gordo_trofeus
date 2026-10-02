import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";

import { config } from "../config.js";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";

/**
 * Cloud saves for emulated games (PS2/PS1 memory-card saves, PPSSPP savedata, Dolphin GCI).
 * Each upload is a version the user can restore; the newest MAX_VERSIONS per save are kept.
 *
 * Upload flow (what the app already speaks): upload-url → PUT bytes to a signed, short-lived URL
 * bound to that save, its owner and its exact size → commit with the file details.
 * Bytes live under data/emulation-saves/<id>.bin, never at a client-chosen path.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS emulation_saves (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    platform TEXT NOT NULL,
    emulator TEXT NOT NULL,
    save_kind TEXT NOT NULL,
    save_identity TEXT NOT NULL,
    shop TEXT,
    object_id TEXT,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT,
    file_name TEXT,
    hostname TEXT,
    local_last_modified_at TEXT,
    label TEXT,
    metadata TEXT,
    uploaded INTEGER NOT NULL DEFAULT 0,
    committed INTEGER NOT NULL DEFAULT 0,
    last_uploaded_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS emulation_saves_user ON emulation_saves (user_id, platform, committed);
`);

const savesDir = path.resolve(import.meta.dirname, "..", "..", "data", "emulation-saves");
fs.mkdirSync(savesDir, { recursive: true });

const PLATFORMS = new Set(["ps1", "ps2", "psp", "gamecube", "wii"]);
const MAX_SAVE_BYTES = 64 * 1024 * 1024;
const MAX_USER_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_VERSIONS = 10;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

interface SaveRow {
  id: string;
  user_id: string;
  platform: string;
  emulator: string;
  save_kind: string;
  save_identity: string;
  shop: string | null;
  object_id: string | null;
  size_bytes: number;
  sha256: string | null;
  file_name: string | null;
  hostname: string | null;
  local_last_modified_at: string | null;
  label: string | null;
  metadata: string | null;
  uploaded: number;
  committed: number;
  last_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
}

const filePathFor = (id: string) => path.join(savesDir, `${id}.bin`);

// --- signed transfer tokens -------------------------------------------------------------------

const sign = (body: string) =>
  crypto.createHmac("sha256", config.jwtSecret).update(`emulation-save:${body}`).digest("base64url");

function signToken(direction: "up" | "down", row: Pick<SaveRow, "id" | "user_id" | "size_bytes">) {
  const body = Buffer.from(
    JSON.stringify({ t: direction, i: row.id, u: row.user_id, s: row.size_bytes, e: Date.now() + TOKEN_TTL_MS })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyToken(token: string, direction: "up" | "down") {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body));
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      t: string; i: string; u: string; s: number; e: number;
    };
    if (payload.t !== direction || payload.e < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- statements --------------------------------------------------------------------------------

const insertPending = db.prepare(`
  INSERT INTO emulation_saves (id, user_id, platform, emulator, save_kind, save_identity, shop, object_id,
    size_bytes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getOwned = db.prepare("SELECT * FROM emulation_saves WHERE id = ? AND user_id = ?");
const getById = db.prepare("SELECT * FROM emulation_saves WHERE id = ?");
const markUploaded = db.prepare(
  "UPDATE emulation_saves SET uploaded = 1, sha256 = ?, updated_at = ? WHERE id = ?"
);
const commitStatement = db.prepare(`
  UPDATE emulation_saves SET committed = 1, file_name = ?, hostname = ?, local_last_modified_at = ?,
    label = ?, metadata = ?, last_uploaded_at = ?, updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const userBytes = db.prepare(
  "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM emulation_saves WHERE user_id = ?"
);
const olderVersions = db.prepare(`
  SELECT id FROM emulation_saves
  WHERE user_id = ? AND platform = ? AND save_identity = ? AND committed = 1
  ORDER BY last_uploaded_at DESC LIMIT -1 OFFSET ?
`);
const deleteRow = db.prepare("DELETE FROM emulation_saves WHERE id = ?");
const stalePending = db.prepare(
  "SELECT id FROM emulation_saves WHERE committed = 0 AND created_at < ?"
);

function removeSave(id: string) {
  deleteRow.run(id);
  fs.rmSync(filePathFor(id), { force: true });
}

function toDto(row: SaveRow) {
  let metadata: unknown = null;
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : null;
  } catch {
    metadata = null;
  }
  return {
    id: row.id,
    platform: row.platform,
    emulator: row.emulator,
    saveKind: row.save_kind,
    saveIdentity: row.save_identity,
    artifactLengthInBytes: row.size_bytes,
    fileName: row.file_name ?? "",
    hostname: row.hostname,
    localLastModifiedAt: row.local_last_modified_at,
    label: row.label,
    metadata,
    shop: row.shop,
    objectId: row.object_id,
    lastUploadedAt: row.last_uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- validation helpers ------------------------------------------------------------------------

const str = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const optionalStr = (value: unknown, max: number) =>
  value == null ? null : typeof value === "string" && value.length <= max ? value : undefined;
const safeFileName = (value: unknown) => {
  const name = str(value, 200);
  return name && !/[\\/\0]/.test(name) && name !== "." && name !== ".." ? name : null;
};
const metadataJson = (value: unknown) => {
  if (value == null) return null;
  if (typeof value !== "object") return undefined;
  const json = JSON.stringify(value);
  return json.length <= 16 * 1024 ? json : undefined;
};

/** Drops uploads that were never committed (interrupted transfers). Runs at boot. */
export function cleanupStaleEmulationSaves() {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  for (const { id } of stalePending.all(cutoff) as { id: string }[]) removeSave(id);
}

export function registerEmulationSaveRoutes(app: FastifyInstance) {
  app.post<{ Body: Record<string, unknown> }>(
    "/profile/emulation-saves/upload-url",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;
      const body = request.body ?? {};
      const platform = str(body.platform, 16);
      const emulator = str(body.emulator, 32);
      const saveKind = str(body.saveKind, 32) ?? "game_save";
      const saveIdentity = str(body.saveIdentity, 256);
      const size = Number(body.artifactLengthInBytes);
      const hasShop = body.shop != null || body.objectId != null;
      const shop = hasShop ? str(body.shop, 16) : null;
      const objectId = hasShop ? str(body.objectId, 128) : null;

      if (
        !platform || !PLATFORMS.has(platform) ||
        !emulator || !/^[a-z0-9_-]+$/.test(emulator) ||
        !/^[a-z_]+$/.test(saveKind) ||
        !saveIdentity ||
        !Number.isSafeInteger(size) || size <= 0 || size > MAX_SAVE_BYTES ||
        (hasShop && (!shop || !objectId))
      ) {
        return reply.code(400).send({ message: "Invalid emulation save" });
      }
      const { total } = userBytes.get(user.id) as { total: number };
      if (total + size > MAX_USER_BYTES) {
        return reply.code(413).send({ message: "Emulation save storage quota exceeded" });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      insertPending.run(id, user.id, platform, emulator, saveKind, saveIdentity, shop, objectId, size, now, now);
      reply.send({
        id,
        uploadUrl: `${config.publicBaseUrl}/emulation-blobs/${signToken("up", { id, user_id: user.id, size_bytes: size })}`,
      });
    }
  );

  // Raw bytes from the app (Content-Type: application/octet-stream), capped per save.
  app.put<{ Params: { token: string } }>(
    "/emulation-blobs/:token",
    { bodyLimit: MAX_SAVE_BYTES },
    async (request, reply) => {
      const token = verifyToken(request.params.token, "up");
      const row = token ? (getById.get(token.i) as SaveRow | undefined) : undefined;
      if (!token || !row || row.user_id !== token.u || row.committed) {
        return reply.code(403).send({ message: "Invalid or expired upload URL" });
      }
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length !== row.size_bytes) {
        return reply.code(400).send({ message: "Upload size mismatch" });
      }
      const target = filePathFor(row.id);
      const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, target);
      markUploaded.run(crypto.createHash("sha256").update(body).digest("hex"), new Date().toISOString(), row.id);
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/profile/emulation-saves/:id/commit",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;
      const row = getOwned.get(request.params.id, user.id) as SaveRow | undefined;
      if (!row) return reply.code(404).send({ message: "Emulation save not found" });
      if (!row.uploaded) return reply.code(409).send({ message: "Upload not finished" });

      const body = request.body ?? {};
      const fileName = safeFileName(body.fileName);
      const hostname = optionalStr(body.hostname, 128);
      const localLastModifiedAt = optionalStr(body.localLastModifiedAt, 64);
      const label = optionalStr(body.label, 200);
      const metadata = metadataJson(body.metadata);
      if (
        !fileName || hostname === undefined || localLastModifiedAt === undefined ||
        label === undefined || metadata === undefined ||
        (body.artifactLengthInBytes != null && Number(body.artifactLengthInBytes) !== row.size_bytes)
      ) {
        return reply.code(400).send({ message: "Invalid commit" });
      }

      const now = new Date().toISOString();
      commitStatement.run(fileName, hostname, localLastModifiedAt, label, metadata, now, now, row.id, user.id);
      for (const { id } of olderVersions.all(user.id, row.platform, row.save_identity, MAX_VERSIONS) as { id: string }[]) {
        removeSave(id);
      }
      reply.send(toDto(getOwned.get(row.id, user.id) as unknown as SaveRow));
    }
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/profile/emulation-saves",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;
      const { platform, emulator, saveKind, shop, objectId } = request.query;
      const clauses = ["user_id = ?", "committed = 1"];
      const params: string[] = [user.id];
      for (const [column, value] of [
        ["platform", platform],
        ["emulator", emulator],
        ["save_kind", saveKind],
        ["shop", shop],
        ["object_id", objectId],
      ] as const) {
        if (typeof value === "string" && value.length > 0 && value.length <= 128) {
          clauses.push(`${column} = ?`);
          params.push(value);
        }
      }
      const rows = db
        .prepare(`SELECT * FROM emulation_saves WHERE ${clauses.join(" AND ")} ORDER BY last_uploaded_at DESC LIMIT 500`)
        .all(...params) as unknown as SaveRow[];
      reply.send(rows.map(toDto));
    }
  );

  app.post<{ Params: { id: string } }>(
    "/profile/emulation-saves/:id/download-url",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;
      const row = getOwned.get(request.params.id, user.id) as SaveRow | undefined;
      if (!row || !row.committed) return reply.code(404).send({ message: "Emulation save not found" });
      reply.send({ downloadUrl: `${config.publicBaseUrl}/emulation-blobs/${signToken("down", row)}` });
    }
  );

  app.get<{ Params: { token: string } }>("/emulation-blobs/:token", async (request, reply) => {
    const token = verifyToken(request.params.token, "down");
    const row = token ? (getById.get(token.i) as SaveRow | undefined) : undefined;
    if (!token || !row || row.user_id !== token.u || !fs.existsSync(filePathFor(row.id))) {
      return reply.code(403).send({ message: "Invalid or expired download URL" });
    }
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Length", String(row.size_bytes));
    return reply.send(fs.createReadStream(filePathFor(row.id)));
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/profile/emulation-saves/:id",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;
      const row = getOwned.get(request.params.id, user.id) as SaveRow | undefined;
      if (!row || !row.committed) return reply.code(404).send({ message: "Emulation save not found" });
      const body = request.body ?? {};
      const label = "label" in body ? optionalStr(body.label, 200) : row.label;
      const metadata = "metadata" in body ? metadataJson(body.metadata) : row.metadata;
      if (label === undefined || metadata === undefined) {
        return reply.code(400).send({ message: "Invalid update" });
      }
      db.prepare("UPDATE emulation_saves SET label = ?, metadata = ?, updated_at = ? WHERE id = ?").run(
        label, metadata, new Date().toISOString(), row.id
      );
      reply.send(toDto(getOwned.get(row.id, user.id) as unknown as SaveRow));
    }
  );

  app.delete<{ Params: { id: string } }>("/profile/emulation-saves/:id", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    const row = getOwned.get(request.params.id, user.id) as SaveRow | undefined;
    if (!row) return reply.code(404).send({ message: "Emulation save not found" });
    removeSave(row.id);
    reply.code(204).send();
  });
}
