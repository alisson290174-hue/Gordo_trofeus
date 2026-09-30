/**
 * End-to-end smoke test for the cloud-save v2 flow, run against a throwaway Fastify app wired to
 * the real dev sqlite. Exercises prepare -> upload -> commit -> list -> restore-manifest ->
 * download-urls -> download -> dedup re-commit -> delete, asserting each step, then cleans up.
 *
 * Run with an explicit local base URL so the signed upload/download URLs point at this process:
 *   PUBLIC_BASE_URL=http://127.0.0.1:39187 npx tsx scripts/cloud-save-smoke.ts
 */
import assert from "node:assert";
import crypto from "node:crypto";
import http from "node:http";

import Fastify from "fastify";

import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { signAccessToken } from "../src/auth/jwt.js";
import { registerCloudSaveRoutes } from "../src/cloud-saves/routes.js";

const port = Number(new URL(config.publicBaseUrl).port || 39187);
const base = config.publicBaseUrl;

const USER_ID = "cloud-smoke-user";
const STEAM_ID = "cloud-smoke-steam";

function seedUser() {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM users WHERE id = ?").run(USER_ID);
  db.prepare(
    `INSERT INTO users (id, steam_id, username, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(USER_ID, STEAM_ID, "smoke", "Smoke Test", now, now);
}

function cleanupUser() {
  // Remove anything this run created so the dev DB is left as we found it.
  const snap = db
    .prepare("SELECT id FROM cloud_snapshots WHERE user_id = ?")
    .all(USER_ID) as { id: string }[];
  for (const { id } of snap) {
    db.prepare("DELETE FROM cloud_snapshot_files WHERE snapshot_id = ?").run(id);
    db.prepare("DELETE FROM cloud_snapshot_variants WHERE snapshot_id = ?").run(id);
    db.prepare("DELETE FROM cloud_snapshot_custom_paths WHERE snapshot_id = ?").run(id);
  }
  db.prepare("DELETE FROM cloud_snapshots WHERE user_id = ?").run(USER_ID);
  db.prepare("DELETE FROM cloud_pending_snapshots WHERE user_id = ?").run(USER_ID);
  db.prepare("DELETE FROM users WHERE id = ?").run(USER_ID);
}

const sha256Hex = (buf: Buffer) =>
  crypto.createHash("sha256").update(buf).digest("hex");

// PUT raw bytes with NO Content-Type, exactly like the native (reqwest) uploader.
function putBlob(
  url: string,
  headers: Record<string, string>,
  body: Buffer
): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "PUT",
        headers: { ...headers, "Content-Length": String(body.length) },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

async function main() {
  seedUser();
  const { token } = signAccessToken(USER_ID, STEAM_ID);

  const app = Fastify({ maxParamLength: 1024 });
  // Match index.ts so a no-Content-Type PUT reaches the handler and empty JSON bodies are ok.
  app.addContentTypeParser(
    ["image/png", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, payload, done) => done(null, payload)
  );
  app.addContentTypeParser("*", (_req, _payload, done) => done(null, undefined));
  registerCloudSaveRoutes(app);
  await app.listen({ port, host: "127.0.0.1" });

  try {
    const shop = "steam";
    const objectId = "9999999";
    const variantId = sha256Hex(Buffer.from("default-variant"));
    const blob = Buffer.from("Balói cloud save smoke test payload");
    const hash = sha256Hex(blob);
    const checksumB64 = Buffer.from(hash, "hex").toString("base64");
    const lastModifiedAt = new Date().toISOString();
    const snapshotHash = sha256Hex(Buffer.from("aggregate-1"));

    const manifest = {
      shop,
      objectId,
      platform: "windows",
      hostname: "smoke-host",
      snapshotHash,
      baseVersion: 0,
      customPathRawPaths: [],
      variants: [{ variantId, kind: "default" }],
      files: [
        {
          variantId,
          rawPath: "<default>/save.dat",
          relativePath: "save.dat",
          hash,
          sizeBytes: blob.length,
          lastModifiedAt,
        },
      ],
    };

    // 1. prepare
    let res = await fetch(`${base}/profile/cloud-saves/prepare-snapshot`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(manifest),
    });
    assert.equal(res.status, 200, "prepare should 200");
    const prepared = (await res.json()) as any;
    assert.equal(prepared.snapshotHash, snapshotHash, "prepare echoes hash");
    assert.equal(prepared.files.length, 1);
    assert.equal(prepared.files[0].status, "upload", "new blob needs upload");
    assert.equal(
      prepared.files[0].requiredHeaders["x-amz-checksum-sha256"],
      checksumB64,
      "checksum header matches"
    );

    // 2. upload the blob (no Content-Type, like the native uploader)
    const putStatus = await putBlob(
      prepared.files[0].uploadUrl,
      { "x-amz-checksum-sha256": checksumB64 },
      blob
    );
    assert.equal(putStatus, 204, "blob PUT should 204");

    // 3. commit
    res = await fetch(`${base}/profile/cloud-saves/commit-snapshot`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ pendingSnapshotId: prepared.pendingSnapshotId }),
    });
    assert.equal(res.status, 200, "commit should 200");
    const committed = (await res.json()) as any;
    assert.equal(committed.version, 1, "first version is 1");
    assert.equal(committed.fileCount, 1);
    assert.equal(committed.totalSizeBytes, blob.length);
    assert.equal(committed.aggregateHash, snapshotHash);
    const snapshotId = committed.snapshotId;

    // 4. list
    res = await fetch(
      `${base}/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`,
      { headers: authHeaders(token) }
    );
    const list = (await res.json()) as any[];
    assert.equal(list.length, 1, "one active snapshot");
    assert.equal(list[0].version, 1);

    // 5. restore manifest
    res = await fetch(
      `${base}/profile/cloud-saves/snapshot-restore-manifest?snapshotId=${snapshotId}`,
      { headers: authHeaders(token) }
    );
    const restore = (await res.json()) as any;
    assert.equal(restore.snapshot.objectId, objectId);
    assert.equal(restore.files.length, 1);
    assert.equal(restore.files[0].hash, hash);

    // 6. download URLs + download
    res = await fetch(
      `${base}/profile/cloud-saves/snapshot-download-urls?snapshotId=${snapshotId}`,
      { headers: authHeaders(token) }
    );
    const dl = (await res.json()) as any[];
    assert.equal(dl.length, 1);
    const blobRes = await fetch(dl[0].downloadUrl);
    assert.equal(blobRes.status, 200, "blob download 200");
    const downloaded = Buffer.from(await blobRes.arrayBuffer());
    assert.ok(downloaded.equals(blob), "downloaded bytes match original");

    // 7. dedup: re-prepare same content at baseVersion 1 -> skip, then commit -> version 2
    res = await fetch(`${base}/profile/cloud-saves/prepare-snapshot`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...manifest, baseVersion: 1 }),
    });
    const prepared2 = (await res.json()) as any;
    assert.equal(
      prepared2.files[0].status,
      "skip",
      "already-stored blob is skipped"
    );
    res = await fetch(`${base}/profile/cloud-saves/commit-snapshot`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ pendingSnapshotId: prepared2.pendingSnapshotId }),
    });
    assert.equal((await res.json()).version, 2, "second commit bumps to v2");

    // 8. stale base version is rejected
    res = await fetch(`${base}/profile/cloud-saves/prepare-snapshot`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...manifest, baseVersion: 0 }),
    });
    const stalePrep = (await res.json()) as any;
    res = await fetch(`${base}/profile/cloud-saves/commit-snapshot`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ pendingSnapshotId: stalePrep.pendingSnapshotId }),
    });
    assert.equal(res.status, 409, "stale baseVersion is a conflict");

    // 9. delete + confirm gone and blob released
    res = await fetch(
      `${base}/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`,
      { method: "DELETE", headers: authHeaders(token) }
    );
    assert.equal(res.status, 204, "delete 204");
    res = await fetch(
      `${base}/profile/cloud-saves/snapshots?shop=${shop}&objectId=${objectId}`,
      { headers: authHeaders(token) }
    );
    assert.equal(((await res.json()) as any[]).length, 0, "no snapshot after delete");
    const blobRow = db
      .prepare("SELECT ref_count FROM cloud_save_blobs WHERE hash = ?")
      .get(hash);
    assert.equal(blobRow, undefined, "blob released and garbage-collected");

    console.log("✅ cloud-save smoke test passed (prepare→upload→commit→list→restore→download→dedup→conflict→delete)");
  } finally {
    await app.close();
    cleanupUser();
  }
}

main().catch((error) => {
  console.error("❌ cloud-save smoke test FAILED:", error);
  cleanupUser();
  process.exit(1);
});
