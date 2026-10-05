import fs from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import { logger } from "@main/services/logger";

/**
 * The taskbar button takes its icon from the Start Menu shortcut that carries the app's
 * AppUserModelID. Some updates leave that shortcut with an empty icon (IconLocation ",0"), and
 * Windows then shows a blank page on the taskbar. Rewrite the shortcut with the icon pointing at
 * our own executable ("update" alone keeps the blank cached icon; a fresh file does not) —
 * only the icon changes; target, arguments, AppUserModelID and toast ID are written back as read.
 */
export function repairStartMenuShortcutIcon() {
  if (process.platform !== "win32" || !app.isPackaged) return;

  const exePath = process.execPath;
  const roots = [
    path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs"
    ),
    path.join(
      process.env.ProgramData ?? "C:\\ProgramData",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs"
    ),
  ];

  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs
        .readdirSync(root)
        .filter((name) => name.toLowerCase().endsWith(".lnk"));
    } catch {
      continue;
    }

    for (const name of entries) {
      const shortcutPath = path.join(root, name);
      try {
        const link = shell.readShortcutLink(shortcutPath);
        if (
          path.resolve(link.target).toLowerCase() !==
          path.resolve(exePath).toLowerCase()
        )
          continue;
        if (link.icon && fs.existsSync(link.icon)) continue;

        const fixed = shell.writeShortcutLink(shortcutPath, "replace", {
          ...link,
          icon: exePath,
          iconIndex: 0,
        });
        logger.info(
          `[shortcut] ${fixed ? "repaired" : "could not repair"} icon of ${shortcutPath}`
        );
      } catch {
        // Not a readable shortcut (or no permission for the all-users one) — leave it alone.
      }
    }
  }
}
