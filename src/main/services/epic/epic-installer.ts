import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { EpicInstallState } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { LocalNotificationManager } from "../notifications/local-notifications";
import { legendaryConfigPath, legendaryInfo, runLegendary } from "./legendary";
import { epicExecutablePath, getEpicInstalled } from "./epic-library";

/**
 * Installs / updates / uninstalls Epic games with Legendary, outside the torrent download manager
 * (which only handles the one download it started). Progress goes to the renderer as
 * "on-epic-install-progress". Cancelling keeps Legendary's resume data, so installing again resumes.
 */
const installs = new Map<string, { state: EpicInstallState; child: ChildProcess }>();

const MIB = 1024 * 1024;
const PROGRESS_RE = /Progress:\s*([\d.]+)%.*?ETA:\s*(\d+):(\d+):(\d+)/;
const DOWNLOADED_RE = /Downloaded:\s*([\d.]+)\s*MiB/;
const SPEED_RE = /\+ Download\s*-\s*([\d.]+)\s*MiB\/s/;
const SIZE_RE = /Download size:\s*([\d.]+)\s*MiB/;

const emit = (state: EpicInstallState) =>
  WindowManager.sendToAppWindows("on-epic-install-progress", { ...state });

export const getEpicInstalls = (): EpicInstallState[] =>
  [...installs.values()].map(({ state }) => ({ ...state }));

async function markInstalled(appName: string) {
  const key = levelKeys.game("epic", appName);
  const game = await gamesSublevel.get(key).catch(() => null);
  const install = (await getEpicInstalled()).get(appName);
  if (game && install) {
    await gamesSublevel.put(key, {
      ...game,
      executablePath: epicExecutablePath(install),
      installedSizeInBytes: install.install_size ?? null,
    });
  }
  WindowManager.sendToAppWindows("on-library-batch-complete");
}

export async function installEpicGame(appName: string, title: string): Promise<void> {
  if (installs.has(appName)) return;
  if (!/^[\w.-]+$/.test(appName)) throw new Error("invalid Epic app name");

  // Integrity check + private config happen inside runLegendary; a cheap call triggers both.
  await runLegendary(["--version"], { timeoutMs: 20_000 });

  const basePath = await getDownloadsPath();
  const child = spawn(
    legendaryInfo().binaryPath,
    ["install", appName, "--base-path", basePath, "-y", "--skip-sdl"],
    {
      windowsHide: true,
      env: {
        ...process.env,
        LEGENDARY_CONFIG_PATH: legendaryConfigPath(),
        PYTHONIOENCODING: "utf-8",
      },
    }
  );

  const state: EpicInstallState = {
    appName,
    title,
    status: "preparing",
    percent: 0,
    downloadedBytes: 0,
    totalBytes: null,
    speedBytes: 0,
    etaSeconds: null,
    error: null,
  };
  installs.set(appName, { state, child });
  emit(state);

  let buffer = "";
  const onOutput = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const size = line.match(SIZE_RE);
      if (size) state.totalBytes = Number(size[1]) * MIB;
      const progress = line.match(PROGRESS_RE);
      if (progress) {
        state.status = "downloading";
        state.percent = Number(progress[1]);
        state.etaSeconds = Number(progress[2]) * 3600 + Number(progress[3]) * 60 + Number(progress[4]);
      }
      const downloaded = line.match(DOWNLOADED_RE);
      if (downloaded) state.downloadedBytes = Number(downloaded[1]) * MIB;
      const speed = line.match(SPEED_RE);
      if (speed) {
        state.speedBytes = Number(speed[1]) * MIB;
        emit(state);
      }
      if (/Verifying|Checking/i.test(line) && state.status !== "downloading") {
        state.status = "verifying";
        emit(state);
      }
    }
  };
  child.stdout?.on("data", onOutput);
  child.stderr?.on("data", onOutput);

  child.on("close", async (code) => {
    installs.delete(appName);
    if (state.status === "cancelled") {
      emit(state);
      return;
    }
    if (code === 0) {
      state.status = "done";
      state.percent = 100;
      await markInstalled(appName).catch((error) =>
        logger.error("[epic] could not update installed game", error)
      );
      await LocalNotificationManager.createNotification(
        "DOWNLOAD_COMPLETE",
        "Instalação concluída",
        `${title} está pronto para jogar`,
        { url: `/game/epic/${appName}` }
      ).catch(() => {});
    } else {
      state.status = "error";
      state.error = buffer.trim().split("\n").pop() || `legendary exited with ${code}`;
      logger.error(`[epic] install of ${appName} failed (${code})`);
    }
    emit(state);
  });
}

/** Stops an install; Legendary keeps resume data, so installing again continues from here. */
export function cancelEpicInstall(appName: string) {
  const entry = installs.get(appName);
  if (!entry?.child.pid) return;
  entry.state.status = "cancelled";
  // Kill the whole tree (the PyInstaller binary spawns a child process).
  execFile("taskkill", ["/PID", String(entry.child.pid), "/T", "/F"], { windowsHide: true }, () => {});
}

export async function uninstallEpicGame(appName: string) {
  if (!/^[\w.-]+$/.test(appName)) throw new Error("invalid Epic app name");
  await runLegendary(["uninstall", appName, "-y"], { timeoutMs: 600_000 });
  const key = levelKeys.game("epic", appName);
  const game = await gamesSublevel.get(key).catch(() => null);
  if (game) await gamesSublevel.put(key, { ...game, executablePath: null, installedSizeInBytes: null });
  WindowManager.sendToAppWindows("on-library-batch-complete");
}

/** Starts the game through Legendary (handles Epic's online auth); detached from Balói. */
export async function launchEpicGame(appName: string) {
  if (!/^[\w.-]+$/.test(appName)) throw new Error("invalid Epic app name");
  await runLegendary(["--version"], { timeoutMs: 20_000 });
  const child = spawn(legendaryInfo().binaryPath, ["launch", appName], {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, LEGENDARY_CONFIG_PATH: legendaryConfigPath() },
  });
  child.unref();
}
