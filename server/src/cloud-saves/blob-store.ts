import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { config } from "../config.js";
import { db } from "../db.js";

/**
 * Content-addressed blob storage for cloud saves. Files are stored on disk under their sha256
 * hash (so identical saves shared across versions/games keep a single copy) and reference-counted
 * so a blob is deleted only once no snapshot points at it. The native client uploads/downloads
 * each blob with a plain HTTP PUT/GET to a signed, short-lived URL we hand out — no S3 needed.
 */

const cloudBlobsDir = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "data",
  "cloud-blobs"
);
fs.mkdirSync(cloudBlobsDir, { recursive: true });

// Cap a single blob (one save file) — generous, but stops a client from filling the disk.
export const MAX_BLOB_BYTES = 512 * 1024 * 1024; // 512MB
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h, plenty for a large upload/download

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export type BlobTokenDirection = "up" | "down";

interface BlobTokenPayload {
  t: BlobTokenDirection;
  u: string; // user id
  h: string; // sha256 hex
  s: number; // size in bytes
  exp: number; // epoch ms
}

const sign = (data: string) =>
  crypto
    .createHmac("sha256", config.jwtSecret)
    .update(data)
    .digest("base64url");

export const signBlobToken = (
  direction: BlobTokenDirection,
  userId: string,
  hash: string,
  sizeBytes: number
): string => {
  const payload: BlobTokenPayload = {
    t: direction,
    u: userId,
    h: hash,
    s: sizeBytes,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
};

export const verifyBlobToken = (token: string): BlobTokenPayload | null => {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(body);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  let payload: BlobTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  } catch {
    return null;
  }

  if (
    (payload.t !== "up" && payload.t !== "down") ||
    typeof payload.u !== "string" ||
    typeof payload.h !== "string" ||
    !HASH_PATTERN.test(payload.h) ||
    typeof payload.s !== "number" ||
    !Number.isSafeInteger(payload.s) ||
    payload.s < 0 ||
    typeof payload.exp !== "number" ||
    payload.exp < Date.now()
  ) {
    return null;
  }

  return payload;
};

const blobPath = (hash: string) =>
  path.join(cloudBlobsDir, hash.slice(0, 2), hash);

const selectBlob = db.prepare(
  "SELECT hash, size_bytes, stored_path, ref_count FROM cloud_save_blobs WHERE hash = ?"
);
const insertBlob = db.prepare(
  `INSERT INTO cloud_save_blobs (hash, size_bytes, stored_path, ref_count, created_at)
   VALUES (?, ?, ?, 0, ?)
   ON CONFLICT(hash) DO NOTHING`
);

export interface CloudBlobRow {
  hash: string;
  size_bytes: number;
  stored_path: string;
  ref_count: number;
}

export const getBlob = (hash: string): CloudBlobRow | undefined =>
  selectBlob.get(hash) as CloudBlobRow | undefined;

/** True once the blob's bytes are physically on disk (i.e. a prior upload finished). */
export const blobIsStored = (hash: string): boolean => {
  const row = getBlob(hash);
  return Boolean(row) && fs.existsSync(blobPath(hash));
};

/**
 * Persist an uploaded blob after verifying its size and sha256 match what the token promised.
 * Idempotent: re-uploading the same hash is a no-op that still succeeds (resumable runs).
 */
export const storeBlob = (
  hash: string,
  expectedSize: number,
  body: Buffer
): { ok: true } | { ok: false; reason: "size" | "hash" } => {
  if (body.length !== expectedSize) return { ok: false, reason: "size" };

  const actualHash = crypto.createHash("sha256").update(body).digest("hex");
  if (actualHash !== hash) return { ok: false, reason: "hash" };

  const target = blobPath(hash);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Write to a temp file then rename, so a crash mid-write never leaves a corrupt blob
    // at the content-addressed path.
    const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
  }

  insertBlob.run(hash, expectedSize, target, new Date().toISOString());
  return { ok: true };
};

export const readBlobStream = (hash: string): fs.ReadStream | null => {
  const target = blobPath(hash);
  if (!fs.existsSync(target)) return null;
  return fs.createReadStream(target);
};

const incRef = db.prepare(
  "UPDATE cloud_save_blobs SET ref_count = ref_count + 1 WHERE hash = ?"
);
const decRef = db.prepare(
  "UPDATE cloud_save_blobs SET ref_count = ref_count - 1 WHERE hash = ? AND ref_count > 0"
);

export const retainBlob = (hash: string) => incRef.run(hash);

/** Drop a reference and, when it reaches zero, delete the blob from disk and the table. */
export const releaseBlob = (hash: string) => {
  decRef.run(hash);
  const row = getBlob(hash);
  if (row && row.ref_count <= 0) {
    const target = blobPath(hash);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {
      // leave the file; the row is gone so it just becomes orphaned disk space
    }
    db.prepare("DELETE FROM cloud_save_blobs WHERE hash = ? AND ref_count <= 0").run(
      hash
    );
  }
};
