import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";
import { createLimiter } from "../rate-limit.js";

/**
 * The user's own app settings (preferences, emulator setup, folders), so a fresh install on a
 * formatted PC comes back configured. One JSON document per user, readable and writable only by
 * that user, size-capped; the app decides what goes in (never passwords or tokens).
 */
const MAX_BYTES = 256 * 1024;
const budget = createLimiter(30, 10 * 60_000);

const select = db.prepare(`SELECT data, updated_at FROM user_settings WHERE user_id = ?`);
const upsert = db.prepare(`
  INSERT INTO user_settings (user_id, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/profile/settings", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    const row = select.get(user.id) as { data: string; updated_at: string } | undefined;
    if (!row) return reply.send(null);
    try {
      return reply.send({ settings: JSON.parse(row.data), updatedAt: row.updated_at });
    } catch {
      return reply.send(null);
    }
  });

  app.put<{ Body: { settings?: unknown } }>("/profile/settings", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    const settings = request.body?.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return reply.code(400).send({ message: "Invalid settings" });
    }
    const data = JSON.stringify(settings);
    if (Buffer.byteLength(data) > MAX_BYTES) return reply.code(413).send({ message: "Settings too large" });
    if (!budget(user.id)) return reply.code(429).send({ message: "Too many requests" });
    const updatedAt = new Date().toISOString();
    upsert.run(user.id, data, updatedAt);
    return reply.send({ ok: true, updatedAt });
  });
}
