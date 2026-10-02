import { createHash } from "node:crypto";
import fs from "node:fs";

/**
 * Integrity rules for the third-party programs Balói downloads and then extracts or runs
 * (emulators, RetroArch and its cores):
 *
 * - Only HTTPS, and only from the projects' official hosts.
 * - GitHub release assets must match the SHA-256 digest GitHub publishes for them; an asset
 *   without a digest is refused (fail closed).
 * - Official hosts that publish no hashes (Dolphin, libretro buildbot) rely on HTTPS + host.
 */
const TRUSTED_HOSTS = new Set(["github.com", "dl.dolphin-emu.org", "buildbot.libretro.com"]);

export class UntrustedDownloadError extends Error {}

export function assertTrustedDownloadUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UntrustedDownloadError("Invalid download URL");
  }
  if (url.protocol !== "https:" || !TRUSTED_HOSTS.has(url.hostname)) {
    throw new UntrustedDownloadError(`Untrusted download host: ${url.hostname}`);
  }
  return url;
}

/** "sha256:abc…" (GitHub's asset `digest`) → "abc…", anything else → null. */
export function parseSha256Digest(digest: string | null | undefined) {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest ?? "");
  return match ? match[1].toLowerCase() : null;
}

export async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

/** Throws unless a GitHub download comes with a digest and the file on disk matches it. */
export async function assertDownloadIntegrity(
  downloadUrl: string,
  filePath: string,
  expectedSha256: string | null | undefined
) {
  const url = assertTrustedDownloadUrl(downloadUrl);
  if (url.hostname === "github.com" && !expectedSha256) {
    throw new UntrustedDownloadError("GitHub asset has no published SHA-256");
  }
  if (!expectedSha256) return;

  const actual = await sha256File(filePath);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new UntrustedDownloadError(
      `SHA-256 mismatch for ${filePath}: expected ${expectedSha256}, got ${actual}`
    );
  }
}
