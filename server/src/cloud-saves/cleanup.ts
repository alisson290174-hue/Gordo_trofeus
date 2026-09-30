import fs from "node:fs";
import path from "node:path";

import { db } from "../db.js";

/**
 * Prune the debris a cloud-save sync can leave behind when it is prepared/uploaded but never
 * committed (e.g. the client crashed or was closed mid-sync):
 *   - pending snapshot rows older than the cutoff (the client re-prepares from scratch anyway), and
 *   - blobs that no committed snapshot references (ref_count 0) and that are older than the cutoff.
 *
 * Content-addressed blobs are shared, so we only ever delete ones with zero references; the age
 * cutoff keeps a blob that was just uploaded and is about to be committed. Runs once on boot —
 * cheap, bounded, and self-healing.
 */
const STALE_CUTOFF_MS = 24 * 60 * 60 * 1000; // 24h

const cloudBlobsDir = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "data",
  "cloud-blobs"
);

const blobPath = (hash: string) =>
  path.join(cloudBlobsDir, hash.slice(0, 2), hash);

export function cleanupStaleCloudSaves(): void {
  const cutoff = new Date(Date.now() - STALE_CUTOFF_MS).toISOString();

  try {
    const pending = db
      .prepare(
        "DELETE FROM cloud_pending_snapshots WHERE created_at < ?"
      )
      .run(cutoff);

    const orphans = db
      .prepare(
        "SELECT hash FROM cloud_save_blobs WHERE ref_count <= 0 AND created_at < ?"
      )
      .all(cutoff) as { hash: string }[];

    for (const { hash } of orphans) {
      const target = blobPath(hash);
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target);
      } catch {
        // leave the file; the row is removed next, so at worst it is orphaned disk we can sweep later
      }
      db.prepare("DELETE FROM cloud_save_blobs WHERE hash = ? AND ref_count <= 0").run(
        hash
      );
    }

    if (pending.changes || orphans.length) {
      console.log(
        `[cloud-save] cleanup: removed ${pending.changes} stale pending snapshot(s) and ${orphans.length} orphaned blob(s)`
      );
    }
  } catch (error) {
    console.error("[cloud-save] cleanup failed", error);
  }
}
