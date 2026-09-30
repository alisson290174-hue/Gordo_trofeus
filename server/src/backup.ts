import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";

/**
 * Daily snapshot of the whole database (users, trophies, friends, souvenirs) into data/backups,
 * keeping the last 7. `VACUUM INTO` writes a consistent copy while the server keeps running.
 */
const backupDir = path.resolve(import.meta.dirname, "..", "data", "backups");
const KEEP = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function runBackup() {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(backupDir, `hydra-${stamp}.sqlite`);
    if (fs.existsSync(target)) return;

    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);

    const old = fs
      .readdirSync(backupDir)
      .filter((file) => /^hydra-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file))
      .sort()
      .slice(0, -KEEP);
    for (const file of old) fs.rmSync(path.join(backupDir, file), { force: true });

    console.log(`[backup] saved ${target}`);
  } catch (error) {
    console.error("[backup] failed", error);
  }
}

export function scheduleDailyBackup() {
  // First one shortly after boot (skipped if today's already exists), then every 24h.
  setTimeout(runBackup, 60_000).unref();
  setInterval(runBackup, DAY_MS).unref();
}
