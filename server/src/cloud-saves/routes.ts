import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { db } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../auth/require-auth.js";
import {
  blobIsStored,
  MAX_BLOB_BYTES,
  readBlobStream,
  releaseBlob,
  retainBlob,
  signBlobToken,
  storeBlob,
  verifyBlobToken,
} from "./blob-store.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

// ---- Shapes coming from the client (validated defensively) -----------------

interface SnapshotVariant {
  variantId: string;
  kind: "default" | "steam-account" | "opaque-folder";
  steamId64?: string;
  concreteFolderId?: string;
}
interface SnapshotFile {
  variantId: string;
  rawPath: string;
  relativePath: string;
  hash: string;
  sizeBytes: number;
  lastModifiedAt: string;
}
interface PrepareBody {
  shop?: unknown;
  objectId?: unknown;
  platform?: unknown;
  hostname?: unknown;
  snapshotHash?: unknown;
  baseVersion?: unknown;
  customPathRawPaths?: unknown;
  variants?: unknown;
  files?: unknown;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const b64Checksum = (hexHash: string) =>
  Buffer.from(hexHash, "hex").toString("base64");

// node:sqlite's DatabaseSync has no .transaction() helper (unlike better-sqlite3), so wrap
// BEGIN/COMMIT/ROLLBACK by hand, matching how db.ts seeds the allowlist.
const runInTransaction = (fn: () => void) => {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

// ---- Prepared statements ----------------------------------------------------

const selectSnapshot = db.prepare(
  `SELECT id, version, snapshot_hash, created_at, updated_at
   FROM cloud_snapshots WHERE user_id = ? AND shop = ? AND object_id = ?`
);
const selectSnapshotFull = db.prepare(
  `SELECT id, user_id, version, shop, object_id, snapshot_hash, created_at, updated_at
   FROM cloud_snapshots WHERE id = ? AND user_id = ?`
);
const selectSnapshotFiles = db.prepare(
  `SELECT variant_id, raw_path, relative_path, hash, size_bytes, last_modified_at
   FROM cloud_snapshot_files WHERE snapshot_id = ?`
);
const selectSnapshotVariants = db.prepare(
  `SELECT variant_id, kind, steam_id64, concrete_folder_id
   FROM cloud_snapshot_variants WHERE snapshot_id = ?`
);
const selectSnapshotCustomPaths = db.prepare(
  "SELECT raw_path FROM cloud_snapshot_custom_paths WHERE snapshot_id = ?"
);

interface SnapshotRow {
  id: string;
  version: number;
  shop: string;
  object_id: string;
  snapshot_hash: string;
  created_at: string;
  updated_at: string;
}
interface FileRow {
  variant_id: string;
  raw_path: string;
  relative_path: string;
  hash: string;
  size_bytes: number;
  last_modified_at: string;
}
interface VariantRow {
  variant_id: string;
  kind: string;
  steam_id64: string | null;
  concrete_folder_id: string | null;
}

const distinctHashes = (files: { hash: string }[]) =>
  new Set(files.map((file) => file.hash));

const fileTotals = (files: FileRow[]) => {
  // De-dupe by content: identical blobs referenced by several paths count once toward size.
  const byHash = new Map<string, number>();
  for (const file of files) byHash.set(file.hash, file.size_bytes);
  const totalSizeBytes = [...byHash.values()].reduce((a, b) => a + b, 0);
  return { fileCount: files.length, totalSizeBytes };
};

const toSummary = (row: SnapshotRow) => {
  const files = selectSnapshotFiles.all(row.id) as unknown as FileRow[];
  const { fileCount, totalSizeBytes } = fileTotals(files);
  return {
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileCount,
    totalSizeBytes,
    aggregateHash: row.snapshot_hash,
  };
};

// ---- Validation of the prepare payload -------------------------------------

const parseVariants = (value: unknown): SnapshotVariant[] => {
  if (!Array.isArray(value)) throw new Error("invalid variants");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("invalid variant");
    const v = raw as Record<string, unknown>;
    if (!isStr(v.variantId) || !HASH_PATTERN.test(v.variantId)) {
      throw new Error("invalid variantId");
    }
    if (v.kind === "default") {
      return { variantId: v.variantId, kind: "default" };
    }
    if (v.kind === "steam-account" && isStr(v.steamId64)) {
      return { variantId: v.variantId, kind: "steam-account", steamId64: v.steamId64 };
    }
    if (v.kind === "opaque-folder" && isStr(v.concreteFolderId)) {
      return {
        variantId: v.variantId,
        kind: "opaque-folder",
        concreteFolderId: v.concreteFolderId,
      };
    }
    throw new Error("invalid variant kind");
  });
};

const parseFiles = (value: unknown): SnapshotFile[] => {
  if (!Array.isArray(value)) throw new Error("invalid files");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("invalid file");
    const f = raw as Record<string, unknown>;
    if (
      !isStr(f.variantId) ||
      !HASH_PATTERN.test(f.variantId) ||
      !isStr(f.rawPath) ||
      !isStr(f.relativePath) ||
      !isStr(f.hash) ||
      !HASH_PATTERN.test(f.hash) ||
      typeof f.sizeBytes !== "number" ||
      !Number.isSafeInteger(f.sizeBytes) ||
      f.sizeBytes < 0 ||
      f.sizeBytes > MAX_BLOB_BYTES ||
      !isStr(f.lastModifiedAt)
    ) {
      throw new Error("invalid file");
    }
    return {
      variantId: f.variantId,
      rawPath: f.rawPath,
      relativePath: f.relativePath,
      hash: f.hash,
      sizeBytes: f.sizeBytes,
      lastModifiedAt: f.lastModifiedAt,
    };
  });
};

interface PendingManifest {
  variants: SnapshotVariant[];
  files: SnapshotFile[];
  customPathRawPaths: string[];
}

const MAX_SNAPSHOT_BYTES = 2 * 1024 ** 3;
const MAX_USER_BYTES = 10 * 1024 ** 3;
// Bytes of the user's committed saves for every other game (this game's save gets replaced).
const selectUserUsageExcludingGame = db.prepare(
  `SELECT SUM(f.size_bytes) AS used
     FROM cloud_snapshot_files f
     JOIN cloud_snapshots s ON s.id = f.snapshot_id
    WHERE s.user_id = ? AND NOT (s.shop = ? AND s.object_id = ?)`
);

export function registerCloudSaveRoutes(app: FastifyInstance) {
  // 1. Prepare: the client proposes a manifest; we hand back per-file upload URLs (or "skip"
  //    when we already hold that blob) plus a pending id it commits with.
  app.post("/profile/cloud-saves/prepare-snapshot", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const body = (request.body ?? {}) as PrepareBody;
    if (
      !isStr(body.shop) ||
      !isStr(body.objectId) ||
      !isStr(body.snapshotHash) ||
      !HASH_PATTERN.test(body.snapshotHash) ||
      typeof body.baseVersion !== "number" ||
      !Number.isSafeInteger(body.baseVersion) ||
      body.baseVersion < 0
    ) {
      return reply.code(400).send({ message: "Invalid prepare payload" });
    }

    let variants: SnapshotVariant[];
    let files: SnapshotFile[];
    let customPathRawPaths: string[];
    try {
      variants = parseVariants(body.variants);
      files = parseFiles(body.files);
      customPathRawPaths = Array.isArray(body.customPathRawPaths)
        ? body.customPathRawPaths.filter((p): p is string => isStr(p))
        : [];
    } catch {
      return reply.code(400).send({ message: "Invalid snapshot manifest" });
    }

    // Storage limits (audit 2026-09-30): one save ≤ 2 GB, all of a user's saves ≤ 10 GB.
    const snapshotBytes = files.reduce((sum, file) => sum + (file.sizeBytes || 0), 0);
    if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
      return reply.code(413).send({ message: "Save too large for cloud sync (max 2 GB)" });
    }
    const { used } = selectUserUsageExcludingGame.get(user.id, body.shop, body.objectId) as {
      used: number | null;
    };
    if ((used ?? 0) + snapshotBytes > MAX_USER_BYTES) {
      return reply.code(413).send({ message: "Cloud save storage full (max 10 GB per user)" });
    }

    const pendingSnapshotId = crypto.randomUUID();
    const manifest: PendingManifest = { variants, files, customPathRawPaths };
    db.prepare(
      `INSERT INTO cloud_pending_snapshots
       (id, user_id, shop, object_id, base_version, snapshot_hash, platform, hostname, manifest_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      pendingSnapshotId,
      user.id,
      body.shop,
      body.objectId,
      body.baseVersion,
      body.snapshotHash,
      isStr(body.platform) ? body.platform : null,
      isStr(body.hostname) ? body.hostname : null,
      JSON.stringify(manifest),
      new Date().toISOString()
    );

    // One upload per distinct blob; the rest of the files sharing that hash ride along.
    const seenHash = new Set<string>();
    const responseFiles = files.map((file) => {
      const common = {
        variantId: file.variantId,
        rawPath: file.rawPath,
        relativePath: file.relativePath,
      };
      const alreadyStored = blobIsStored(file.hash);
      const dupInThisSnapshot = seenHash.has(file.hash);
      seenHash.add(file.hash);

      if (alreadyStored || dupInThisSnapshot) {
        return { ...common, status: "skip" as const };
      }
      return {
        ...common,
        status: "upload" as const,
        uploadUrl: `${config.publicBaseUrl}/cloud-blobs/${signBlobToken(
          "up",
          user.id,
          file.hash,
          file.sizeBytes
        )}`,
        requiredHeaders: {
          "Content-Length": String(file.sizeBytes),
          "x-amz-checksum-sha256": b64Checksum(file.hash),
        },
      };
    });

    return reply.send({
      pendingSnapshotId,
      snapshotHash: body.snapshotHash,
      files: responseFiles,
    });
  });

  // 2. Commit: publish the pending manifest once every proposed blob is on disk. Replaces the
  //    game's previous snapshot and bumps the version, with optimistic concurrency on baseVersion.
  app.post("/profile/cloud-saves/commit-snapshot", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const pendingSnapshotId = (request.body as { pendingSnapshotId?: unknown })
      ?.pendingSnapshotId;
    if (!isStr(pendingSnapshotId)) {
      return reply.code(400).send({ message: "Missing pendingSnapshotId" });
    }

    const pending = db
      .prepare(
        `SELECT id, user_id, shop, object_id, base_version, snapshot_hash, platform, hostname, manifest_json
         FROM cloud_pending_snapshots WHERE id = ? AND user_id = ?`
      )
      .get(pendingSnapshotId, user.id) as
      | {
          id: string;
          shop: string;
          object_id: string;
          base_version: number;
          snapshot_hash: string;
          platform: string | null;
          hostname: string | null;
          manifest_json: string;
        }
      | undefined;
    if (!pending) {
      return reply.code(404).send({ message: "Unknown pending snapshot" });
    }

    const manifest = JSON.parse(pending.manifest_json) as PendingManifest;

    // Every distinct blob referenced must have finished uploading.
    for (const hash of distinctHashes(manifest.files)) {
      if (!blobIsStored(hash)) {
        return reply
          .code(409)
          .send({ message: "Some snapshot files were not uploaded" });
      }
    }

    const existing = selectSnapshot.get(user.id, pending.shop, pending.object_id) as
      | SnapshotRow
      | undefined;
    const currentVersion = existing?.version ?? 0;
    if (pending.base_version !== currentVersion) {
      // Someone else committed since this snapshot was prepared.
      return reply
        .code(409)
        .send({ message: "Snapshot base version is stale" });
    }

    const now = new Date().toISOString();
    const newVersion = currentVersion + 1;
    const snapshotId = existing?.id ?? crypto.randomUUID();
    const createdAt = existing?.created_at ?? now;

    runInTransaction(() => {
      // Retain the new snapshot's blobs BEFORE releasing the old one's, so a blob shared by both
      // never momentarily hits zero refs and gets deleted from disk mid-commit.
      for (const hash of distinctHashes(manifest.files)) retainBlob(hash);

      if (existing) {
        const oldFiles = selectSnapshotFiles.all(existing.id) as unknown as FileRow[];
        // Delete the old file rows first (they FK-reference blobs), then drop the old refs.
        db.prepare("DELETE FROM cloud_snapshot_files WHERE snapshot_id = ?").run(existing.id);
        db.prepare("DELETE FROM cloud_snapshot_variants WHERE snapshot_id = ?").run(existing.id);
        db.prepare("DELETE FROM cloud_snapshot_custom_paths WHERE snapshot_id = ?").run(existing.id);
        for (const hash of distinctHashes(oldFiles)) releaseBlob(hash);
        db.prepare(
          "UPDATE cloud_snapshots SET version = ?, snapshot_hash = ?, platform = ?, hostname = ?, updated_at = ? WHERE id = ?"
        ).run(newVersion, pending.snapshot_hash, pending.platform, pending.hostname, now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO cloud_snapshots
           (id, user_id, shop, object_id, version, snapshot_hash, platform, hostname, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          snapshotId, user.id, pending.shop, pending.object_id, newVersion,
          pending.snapshot_hash, pending.platform, pending.hostname, createdAt, now
        );
      }

      const insertVariant = db.prepare(
        `INSERT INTO cloud_snapshot_variants (snapshot_id, variant_id, kind, steam_id64, concrete_folder_id)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const variant of manifest.variants) {
        insertVariant.run(
          snapshotId, variant.variantId, variant.kind,
          variant.steamId64 ?? null, variant.concreteFolderId ?? null
        );
      }

      const insertCustomPath = db.prepare(
        "INSERT INTO cloud_snapshot_custom_paths (snapshot_id, raw_path) VALUES (?, ?)"
      );
      for (const rawPath of manifest.customPathRawPaths) {
        insertCustomPath.run(snapshotId, rawPath);
      }

      const insertFile = db.prepare(
        `INSERT INTO cloud_snapshot_files
         (snapshot_id, variant_id, raw_path, relative_path, hash, size_bytes, last_modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const file of manifest.files) {
        insertFile.run(
          snapshotId, file.variantId, file.rawPath, file.relativePath,
          file.hash, file.sizeBytes, file.lastModifiedAt
        );
      }

      db.prepare("DELETE FROM cloud_pending_snapshots WHERE id = ?").run(pending.id);
    });

    const { fileCount, totalSizeBytes } = fileTotals(
      manifest.files.map((file) => ({
        variant_id: file.variantId,
        raw_path: file.rawPath,
        relative_path: file.relativePath,
        hash: file.hash,
        size_bytes: file.sizeBytes,
        last_modified_at: file.lastModifiedAt,
      }))
    );

    return reply.send({
      snapshotId,
      version: newVersion,
      fileCount,
      totalSizeBytes,
      aggregateHash: pending.snapshot_hash,
    });
  });

  // 3. List: 0 or 1 active snapshot for the game.
  app.get("/profile/cloud-saves/snapshots", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    const query = request.query as { shop?: string; objectId?: string };
    if (!isStr(query.shop) || !isStr(query.objectId)) {
      return reply.code(400).send({ message: "Missing shop/objectId" });
    }
    const row = selectSnapshot.get(user.id, query.shop, query.objectId) as
      | SnapshotRow
      | undefined;
    return reply.send(row ? [toSummary(row)] : []);
  });

  // 4. Restore manifest: full variant/file listing to plan a restore.
  app.get(
    "/profile/cloud-saves/snapshot-restore-manifest",
    async (request, reply) => {
      const found = requireOwnedSnapshot(request, reply);
      if (!found) return;
      const { row } = found;
      const variants = (selectSnapshotVariants.all(row.id) as unknown as VariantRow[]).map(
        (v) => ({
          variantId: v.variant_id,
          kind: v.kind,
          ...(v.kind === "steam-account" ? { steamId64: v.steam_id64 } : {}),
          ...(v.kind === "opaque-folder"
            ? { concreteFolderId: v.concrete_folder_id }
            : {}),
        })
      );
      const files = (selectSnapshotFiles.all(row.id) as unknown as FileRow[]).map(toFileDto);
      const customPathRawPaths = (
        selectSnapshotCustomPaths.all(row.id) as unknown as { raw_path: string }[]
      ).map((r) => r.raw_path);

      return reply.send({
        snapshot: {
          id: row.id,
          version: row.version,
          shop: row.shop,
          objectId: row.object_id,
        },
        customPathRawPaths,
        variants,
        files,
      });
    }
  );

  // 5. Download URLs: signed GET URLs for each file's blob.
  app.get(
    "/profile/cloud-saves/snapshot-download-urls",
    async (request, reply) => {
      const found = requireOwnedSnapshot(request, reply);
      if (!found) return;
      const { row } = found;
      const files = (selectSnapshotFiles.all(row.id) as unknown as FileRow[]).map(
        (file) => ({
          ...toFileDto(file),
          downloadUrl: `${config.publicBaseUrl}/cloud-blobs/${signBlobToken(
            "down",
            found.userId,
            file.hash,
            file.size_bytes
          )}`,
        })
      );
      return reply.send(files);
    }
  );

  // 6. Delete: drop the game's snapshot and release its blobs.
  app.delete("/profile/cloud-saves/snapshots", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    const query = request.query as { shop?: string; objectId?: string };
    if (!isStr(query.shop) || !isStr(query.objectId)) {
      return reply.code(400).send({ message: "Missing shop/objectId" });
    }
    const row = selectSnapshot.get(user.id, query.shop, query.objectId) as
      | SnapshotRow
      | undefined;
    if (row) {
      runInTransaction(() => {
        const files = selectSnapshotFiles.all(row.id) as unknown as FileRow[];
        db.prepare("DELETE FROM cloud_snapshots WHERE id = ?").run(row.id);
        // ON DELETE CASCADE clears children; release the blob references afterwards.
        for (const hash of distinctHashes(files)) releaseBlob(hash);
      });
    }
    return reply.code(204).send();
  });

  // 7. Blob upload target (the native client PUTs raw bytes here). reqwest sends no Content-Type,
  //    so Fastify's body parser yields nothing — read the raw stream ourselves, capped at the
  //    size the signed token promised.
  app.put<{ Params: { token: string } }>(
    "/cloud-blobs/:token",
    async (request, reply) => {
      const payload = verifyBlobToken(request.params.token);
      if (!payload || payload.t !== "up") {
        return reply.code(403).send({ message: "Invalid or expired upload URL" });
      }

      let body: Buffer;
      // The native uploader sends no Content-Type, so Fastify's parsers give us nothing and we
      // read the raw stream. If some client does send octet-stream, the body is already buffered.
      if (Buffer.isBuffer(request.body)) {
        body = request.body;
      } else {
        try {
          body = await readRawBody(request, payload.s);
        } catch (error) {
          if (error instanceof TooLargeError) {
            return reply.code(413).send({ message: "Blob exceeds declared size" });
          }
          return reply.code(400).send({ message: "Failed to read upload body" });
        }
      }

      const result = storeBlob(payload.h, payload.s, body);
      if (!result.ok) {
        return reply
          .code(400)
          .send({ message: `Blob ${result.reason} mismatch` });
      }
      return reply.code(204).send();
    }
  );

  // 8. Blob download target (the native client GETs raw bytes here).
  app.get<{ Params: { token: string } }>(
    "/cloud-blobs/:token",
    async (request, reply) => {
      const payload = verifyBlobToken(request.params.token);
      if (!payload || payload.t !== "down") {
        return reply.code(403).send({ message: "Invalid or expired download URL" });
      }
      const stream = readBlobStream(payload.h);
      if (!stream) {
        return reply.code(404).send({ message: "Blob not found" });
      }
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Length", String(payload.s));
      return reply.send(stream);
    }
  );
}

class TooLargeError extends Error {}

/**
 * Collect the raw request body into a Buffer, aborting if it exceeds `maxBytes` (the size the
 * signed token vouched for). Used because the native uploader sends no Content-Type, so Fastify's
 * content-type parsers don't produce a body for us.
 */
function readRawBody(
  request: FastifyRequest,
  maxBytes: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.raw.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        request.raw.destroy();
        reject(new TooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.raw.on("end", () => resolve(Buffer.concat(chunks)));
    request.raw.on("error", reject);
  });
}

const toFileDto = (file: FileRow) => ({
  variantId: file.variant_id,
  rawPath: file.raw_path,
  relativePath: file.relative_path,
  hash: file.hash,
  sizeBytes: file.size_bytes,
  lastModifiedAt: file.last_modified_at,
});

/** Shared guard for restore-manifest / download-urls: load a snapshot by id owned by the caller. */
function requireOwnedSnapshot(
  request: FastifyRequest,
  reply: FastifyReply
): { row: SnapshotRow; userId: string } | null {
  const user = requireAuth(request, reply);
  if (!user) return null;
  const snapshotId = (request.query as { snapshotId?: string }).snapshotId;
  if (!isStr(snapshotId)) {
    reply.code(400).send({ message: "Missing snapshotId" });
    return null;
  }
  const row = selectSnapshotFull.get(snapshotId, user.id) as
    | SnapshotRow
    | undefined;
  if (!row) {
    reply.code(404).send({ message: "Snapshot not found" });
    return null;
  }
  return { row, userId: user.id };
}
