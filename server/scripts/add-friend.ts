import { db } from "../src/db.js";

const [steamId, ...noteParts] = process.argv.slice(2);

if (!steamId || !/^\d{17}$/.test(steamId)) {
  console.error("Uso: yarn seed-friend <steamid64> [nota opcional]");
  process.exit(1);
}

db.prepare(
  `INSERT INTO allowed_steam_ids (steam_id, note, added_at)
   VALUES (?, ?, ?)
   ON CONFLICT(steam_id) DO UPDATE SET note = excluded.note`
).run(steamId, noteParts.join(" ") || null, new Date().toISOString());

console.log(`Steam ID ${steamId} adicionado à allowlist.`);
