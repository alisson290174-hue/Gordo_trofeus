import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertDownloadIntegrity,
  assertTrustedDownloadUrl,
  parseSha256Digest,
  UntrustedDownloadError,
} from "./verified-download";

describe("verified-download", () => {
  let dir: string;
  let file: string;
  const content = Buffer.from("emulator archive bytes");
  const sha = createHash("sha256").update(content).digest("hex");
  const githubUrl =
    "https://github.com/PCSX2/pcsx2/releases/download/v2.8.2/pcsx2.7z";

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vdl-"));
    file = path.join(dir, "pcsx2.7z");
    fs.writeFileSync(file, content);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("parses GitHub digests", () => {
    assert.equal(parseSha256Digest(`sha256:${sha.toUpperCase()}`), sha);
    assert.equal(parseSha256Digest("md5:abc"), null);
    assert.equal(parseSha256Digest(null), null);
  });

  it("only allows https on the official hosts", () => {
    assert.doesNotThrow(() => assertTrustedDownloadUrl(githubUrl));
    assert.doesNotThrow(() =>
      assertTrustedDownloadUrl("https://dl.dolphin-emu.org/x.7z")
    );
    for (const bad of [
      "http://github.com/x.7z",
      "https://github.com.evil.example/x.7z",
      "https://evil.example/x.7z",
      "file:///C:/x.7z",
      "not a url",
    ]) {
      assert.throws(
        () => assertTrustedDownloadUrl(bad),
        UntrustedDownloadError,
        bad
      );
    }
  });

  it("accepts a GitHub file whose SHA-256 matches", async () => {
    await assertDownloadIntegrity(githubUrl, file, sha);
  });

  it("refuses a tampered GitHub file", async () => {
    await assert.rejects(
      assertDownloadIntegrity(githubUrl, file, "0".repeat(64)),
      UntrustedDownloadError
    );
  });

  it("refuses a GitHub file without a published digest", async () => {
    await assert.rejects(
      assertDownloadIntegrity(githubUrl, file, null),
      UntrustedDownloadError
    );
  });

  it("accepts hash-less official hosts over https", async () => {
    await assertDownloadIntegrity(
      "https://buildbot.libretro.com/x.zip",
      file,
      null
    );
  });
});
