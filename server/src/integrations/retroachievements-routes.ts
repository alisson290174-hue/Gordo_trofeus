import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth/require-auth.js";

/**
 * RetroAchievements account integration. The client's connect modal was failing because these
 * endpoints didn't exist on this server (they're a Hydra feature that wasn't ported). Credentials
 * are validated against the official RetroAchievements Web API and stored per user.
 */

interface RaIntegrationRow {
  user_id: string;
  username: string;
  web_api_key: string;
  ra_user_id: string | null;
  connected_at: string;
}

const getStatement = db.prepare(
  "SELECT * FROM retroachievements_integrations WHERE user_id = ?"
);
const upsertStatement = db.prepare(`
  INSERT INTO retroachievements_integrations (user_id, username, web_api_key, ra_user_id, connected_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    username = excluded.username, web_api_key = excluded.web_api_key,
    ra_user_id = excluded.ra_user_id, connected_at = excluded.connected_at
`);
const deleteStatement = db.prepare(
  "DELETE FROM retroachievements_integrations WHERE user_id = ?"
);

/** Validates the credentials against RetroAchievements' public Web API (the API key + username is
 * what authenticates read access). Returns the resolved account on success, null on failure. */
async function validateRetroAchievements(
  username: string,
  webApiKey: string
): Promise<{ username: string; raUserId: string | null } | null> {
  const url = new URL(
    "https://retroachievements.org/API/API_GetUserProfile.php"
  );
  url.searchParams.set("u", username);
  url.searchParams.set("y", webApiKey);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) return null;

  const data = (await response.json().catch(() => null)) as {
    User?: string;
    ID?: number;
  } | null;
  // A bad key/username returns an error object without a User field.
  if (!data?.User) return null;

  return { username: data.User, raUserId: data.ID != null ? String(data.ID) : null };
}

function toIntegration(row: RaIntegrationRow | undefined) {
  if (!row) return { connected: false as const };
  return {
    connected: true as const,
    username: row.username,
    retroAchievementsUserId: row.ra_user_id,
    retroAchievementsAccountStatus: "active" as const,
  };
}

export function registerRetroAchievementsRoutes(app: FastifyInstance) {
  app.get("/profile/integrations/retroachievements", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    reply.send(
      toIntegration(getStatement.get(user.id) as RaIntegrationRow | undefined)
    );
  });

  app.post<{
    Body: {
      data?: { username?: string; password?: string; webApiKey?: string };
    };
  }>("/profile/integrations/retroachievements/connect", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const username = (request.body?.data?.username ?? "").trim();
    const webApiKey = (request.body?.data?.webApiKey ?? "").trim();
    if (!username || !webApiKey) {
      return reply.code(400).send({ message: "username and webApiKey required" });
    }

    const valid = await validateRetroAchievements(username, webApiKey);
    if (!valid) {
      return reply
        .code(400)
        .send({ message: "Invalid RetroAchievements credentials" });
    }

    upsertStatement.run(
      user.id,
      valid.username,
      webApiKey,
      valid.raUserId,
      new Date().toISOString()
    );

    reply.send({
      connected: true,
      username: valid.username,
      retroAchievementsUserId: valid.raUserId,
      retroAchievementsAccountStatus: "active",
    });
  });

  app.delete("/profile/integrations/retroachievements", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    deleteStatement.run(user.id);
    reply.code(204).send();
  });
}
