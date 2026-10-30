import { spawnSync } from "node:child_process";
import { resolveEmulatorExecutableTarget } from "./macos-app-bundle";
import {
  isEmulatorVersionProbeEnabled,
  type EmulatorVersionProbe,
} from "./emulator-version-probe";

const VERSION_REGEX = /\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]*)/;

/**
 * The version stamped in a Windows executable (PCSX2, PPSSPP, shadPS4, DuckStation have one).
 * Read from the file, so it works for emulators whose `--version` would open a window, and it
 * stays right after the emulator updated itself. "2.7.524.0" → "2.7.524".
 */
const readWindowsFileVersion = (executablePath: string): string | null => {
  if (process.platform !== "win32") return null;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$v = (Get-Item -LiteralPath $env:OPUS_VERSION_TARGET).VersionInfo; if ($v.ProductVersion) { $v.ProductVersion } else { $v.FileVersion }",
    ],
    {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
      env: { ...process.env, OPUS_VERSION_TARGET: executablePath },
    }
  );
  if (result.error) return null;
  const match = VERSION_REGEX.exec(result.stdout ?? "");
  return match ? match[0].replace(/^(\d+\.\d+\.\d+)\.0$/, "$1") : null;
};

export const getEmulatorVersion = (
  executablePath: string,
  binary: EmulatorVersionProbe
): string | null => {
  const fileVersion = readWindowsFileVersion(executablePath);
  if (fileVersion) return fileVersion;

  if (!isEmulatorVersionProbeEnabled(binary)) return null;

  const executableTarget = resolveEmulatorExecutableTarget(executablePath);
  if (!executableTarget) return null;

  for (const flag of binary.versionFlags) {
    const result = spawnSync(executableTarget, [flag], {
      encoding: "utf8",
      shell: false,
      timeout: 5000,
    });

    if (result.error) continue;

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const match = VERSION_REGEX.exec(output);
    if (match) return match[0];
  }

  return null;
};
