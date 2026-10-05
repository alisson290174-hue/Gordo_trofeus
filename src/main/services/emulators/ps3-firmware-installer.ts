import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";

import { logger } from "../logger";
import { SystemPath } from "../system-path";
import { downloadToFile, removeFileQuietly } from "../download-to-file";
import { isPs3FirmwareInstalled } from "./firmware-detection";
import { parsePs3UpdateList } from "./ps3-update-list";

/**
 * PS3 system software for RPCS3, straight from Sony's update servers (the same files a real PS3
 * downloads). Sony serves them over HTTP only, so integrity comes from two checks instead of TLS:
 * the MD5 Sony puts in the file's own CDN path, and RPCS3 validating the PUP's Sony signatures
 * while installing (a tampered firmware is rejected). Installed headless: no window, then exits.
 */
const UPDATE_LIST =
  "http://fus01.ps3.update.playstation.net/update/ps3/list/us/ps3-updatelist.txt";
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

const md5File = async (filePath: string) => {
  const hash = createHash("md5");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
};

const runHeadlessInstall = (executablePath: string, pupPath: string) =>
  new Promise<number | null>((resolve) => {
    const child = spawn(
      executablePath,
      ["--headless", "--installfw", pupPath],
      {
        cwd: path.dirname(executablePath),
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      }
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, INSTALL_TIMEOUT_MS);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

export async function installPs3FirmwareIfMissing(
  executablePath: string
): Promise<"ready" | "installed" | "failed"> {
  if (await isPs3FirmwareInstalled(executablePath)) return "ready";

  const pupPath = path.join(SystemPath.getPath("temp"), "baloi-PS3UPDAT.PUP");
  try {
    const { data } = await axios.get<string>(UPDATE_LIST, {
      responseType: "text",
      timeout: 20_000,
      maxContentLength: 64 * 1024,
    });
    const pup = parsePs3UpdateList(String(data));
    if (!pup) throw new Error("PS3 update list has no full firmware image");

    await downloadToFile(pup.url, pupPath, () => {});
    if ((await md5File(pupPath)) !== pup.md5)
      throw new Error("PS3 firmware MD5 mismatch");

    const exitCode = await runHeadlessInstall(executablePath, pupPath);
    const installed = await isPs3FirmwareInstalled(executablePath);
    logger.info("[ps3-firmware] headless install finished", {
      exitCode,
      installed,
    });
    return installed ? "installed" : "failed";
  } catch (error) {
    logger.error("[ps3-firmware] install failed", error);
    return "failed";
  } finally {
    await removeFileQuietly(pupPath);
  }
}
