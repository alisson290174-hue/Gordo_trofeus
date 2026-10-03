import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";
import { createLimiter } from "../rate-limit.js";

/**
 * PS3 trophy lists. RPCS3 keeps a game's trophy set (TROPCONF.SFM) on the player's PC; the app sends
 * it here so the profile, friends and comparisons see the same list as any other game. Only PS3
 * games (serial-based IDs like rom-sku-BLES00150) are accepted, and only text fields — icons stay
 * on the player's PC.
 *
 * PS3 grades are fixed by the game, while Balói tiers come from rarity: each grade is stored with a
 * rarity that lands in the same tier (platinum/gold < 10 %, silver < 40 %, bronze above).
 */
const GRADE_PERCENT: Record<string, number> = { P: 1, G: 5, S: 25, B: 60 };
const PS3_OBJECT_ID = /^rom-sku-[A-Z]{4}\d{5}$/;
const MAX_TROPHIES = 300;

const budget = createLimiter(60, 10 * 60_000);

const upsertStatement = db.prepare(`
  INSERT INTO achievement_catalogue (shop, object_id, name, display_name, description, icon, icongray, hidden, global_unlock_percent, cached_at, lang)
  VALUES ('launchbox', $objectId, $name, $displayName, $description, NULL, NULL, $hidden, $percent, $cachedAt, 'brazilian')
  ON CONFLICT(shop, object_id, name) DO UPDATE SET
    display_name = excluded.display_name, description = excluded.description, hidden = excluded.hidden,
    global_unlock_percent = excluded.global_unlock_percent, cached_at = excluded.cached_at, lang = excluded.lang
`);

interface TrophyInput {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  hidden?: unknown;
  grade?: unknown;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : null;

export function registerPs3TrophyRoutes(app: FastifyInstance) {
  app.put<{ Params: { objectId: string }; Body: { trophies?: TrophyInput[] } }>(
    "/profile/games/launchbox/:objectId/ps3-trophies",
    async (request, reply) => {
      const user = requireAuth(request, reply);
      if (!user) return;
      const { objectId } = request.params;
      const trophies = request.body?.trophies;
      if (!PS3_OBJECT_ID.test(objectId) || !Array.isArray(trophies) || trophies.length === 0 || trophies.length > MAX_TROPHIES) {
        return reply.code(400).send({ message: "Invalid trophy list" });
      }
      if (!budget(user.id)) return reply.code(429).send({ message: "Too many requests" });

      const rows = trophies.map((trophy) => ({
        name: text(trophy.name, 8),
        displayName: text(trophy.displayName, 200),
        description: text(trophy.description, 500),
        hidden: trophy.hidden === true ? 1 : 0,
        percent: GRADE_PERCENT[String(trophy.grade)] ?? null,
      }));
      if (rows.some((row) => !row.name || !/^\d{1,3}$/.test(row.name) || row.percent === null)) {
        return reply.code(400).send({ message: "Invalid trophy" });
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        for (const row of rows) {
          upsertStatement.run({
            $objectId: objectId,
            $name: row.name,
            $displayName: row.displayName,
            $description: row.description,
            $hidden: row.hidden,
            $percent: row.percent,
            $cachedAt: now,
          });
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      reply.send({ ok: true, count: rows.length });
    }
  );
}
