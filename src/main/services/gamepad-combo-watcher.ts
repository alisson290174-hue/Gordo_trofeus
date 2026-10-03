import { type ChildProcess, spawn } from "node:child_process";

import { logger } from "./logger";

/**
 * Select + Start on any Xbox-class pad closes the running game and brings Opus back, whatever the
 * game or emulator. Browser windows only see a pad while they're visible, and a game covers them,
 * so the buttons are read straight from Windows (XInputGetState) by a tiny PowerShell loop that
 * only runs while a game is open.
 */

// XINPUT_GAMEPAD_START | XINPUT_GAMEPAD_BACK
const POLL_SCRIPT = (parentPid: number) => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OpusXInput {
  [StructLayout(LayoutKind.Sequential)] public struct Pad { public ushort Buttons; public byte LT; public byte RT; public short LX; public short LY; public short RX; public short RY; }
  [StructLayout(LayoutKind.Sequential)] public struct State { public uint Packet; public Pad Gamepad; }
  [DllImport("xinput1_4.dll")] public static extern uint XInputGetState(uint index, out State state);
}
"@
$held = $false
$tick = 0
while ($true) {
  $combo = $false
  for ($i = 0; $i -lt 4; $i++) {
    $s = New-Object OpusXInput+State
    if ([OpusXInput]::XInputGetState($i, [ref]$s) -eq 0 -and (($s.Gamepad.Buttons -band 0x30) -eq 0x30)) { $combo = $true }
  }
  if ($combo -and -not $held) { [Console]::Out.WriteLine('COMBO'); [Console]::Out.Flush() }
  $held = $combo
  $tick++
  if ($tick % 40 -eq 0 -and -not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { exit }
  Start-Sleep -Milliseconds 50
}
`;

let child: ChildProcess | null = null;
let onCombo: (() => void) | null = null;

const start = () => {
  if (child || process.platform !== "win32") return;
  child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POLL_SCRIPT(process.pid)],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (chunk.includes("COMBO")) {
      logger.info("[gamepad] Select+Start: closing the running game");
      onCombo?.();
    }
  });
  child.stderr?.on("data", (chunk) => logger.warn("[gamepad] combo watcher:", String(chunk).slice(0, 300)));
  child.on("exit", () => {
    child = null;
  });
};

const stop = () => {
  if (!child) return;
  child.kill();
  child = null;
};

export const GamepadComboWatcher = {
  /** What Select+Start does (set once at startup). */
  setHandler(handler: () => void) {
    onCombo = handler;
  },
  /** Watch the pad only while something is running. */
  sync(gameRunning: boolean) {
    if (gameRunning) start();
    else stop();
  },
  stop,
};
