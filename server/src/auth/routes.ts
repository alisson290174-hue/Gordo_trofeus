import type { FastifyInstance } from "fastify";
import {
  extractSteamId64,
  fetchSteamPersona,
  getSteamAuthUrl,
  verifySteamAssertion,
} from "./steam.js";
import { isSteamIdAllowedToLogin } from "./allowlist.js";
import { getUserById, getUserBySteamId, upsertUserFromSteamLogin } from "../users.js";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "./jwt.js";
import { resolveRefreshToken, revokeRefreshToken, storeRefreshToken } from "./refresh-store.js";
import { config } from "../config.js";

function restrictedAccessPage(): string {
  return `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:4rem">
    <h1>Acesso restrito</h1>
    <p>Este Steam ID não está autorizado a entrar neste servidor.</p>
  </body></html>`;
}

function redirectToAppPage(payloadBase64: string): string {
  const deepLink = `hydralauncher://auth?payload=${payloadBase64}`;
  return `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${deepLink}"></head>
    <body><script>window.location.href = ${JSON.stringify(deepLink)};</script>
    <p>Você pode fechar esta janela.</p></body></html>`;
}

export function registerAuthRoutes(app: FastifyInstance) {
  // WindowManager.openAuthWindow loads "<MAIN_VITE_AUTH_URL>/" (AuthPage.SignIn) as the first
  // page in the auth window — send it straight into the Steam login flow.
  app.get("/", async (_request, reply) => {
    reply.redirect("/auth/steam");
  });

  app.get("/auth/steam", async (_request, reply) => {
    const authUrl = await getSteamAuthUrl();
    reply.redirect(authUrl);
  });

  app.get("/auth/steam/return", async (request, reply) => {
    const fullUrl = `${config.publicBaseUrl}${request.raw.url}`;
    const { authenticated, claimedIdentifier } = await verifySteamAssertion(fullUrl);

    if (!authenticated || !claimedIdentifier) {
      return reply.code(401).type("text/html").send(restrictedAccessPage());
    }

    const steamId = extractSteamId64(claimedIdentifier);
    if (!steamId || !isSteamIdAllowedToLogin(steamId)) {
      return reply.code(403).type("text/html").send(restrictedAccessPage());
    }

    const isFirstLogin = !getUserBySteamId(steamId);
    const persona = isFirstLogin ? await fetchSteamPersona(steamId) : null;
    const user = upsertUserFromSteamLogin(
      steamId,
      persona?.personaName ?? null,
      persona?.avatarFull ?? null
    );

    const { token: accessToken, expiresIn } = signAccessToken(user.id, steamId);
    const { raw: refreshToken, hash } = generateRefreshToken();
    storeRefreshToken(hash, user.id);

    const payload = Buffer.from(
      JSON.stringify({ accessToken, expiresIn, refreshToken, workwondersJwt: "" })
    ).toString("base64");

    reply.type("text/html").send(redirectToAppPage(payload));
  });

  app.post<{ Body: { refreshToken?: string } }>("/auth/refresh", async (request, reply) => {
    const { refreshToken } = request.body ?? {};
    if (!refreshToken) return reply.code(400).send({ message: "refreshToken is required" });

    const userId = resolveRefreshToken(hashRefreshToken(refreshToken));
    if (!userId) return reply.code(401).send({ message: "Invalid or expired refresh token" });

    const user = getUserById(userId);
    if (!user) return reply.code(401).send({ message: "User not found" });

    const { token: accessToken, expiresIn } = signAccessToken(user.id, user.steam_id);
    reply.send({ accessToken, expiresIn });
  });

  app.post<{ Body: { refreshToken?: string } }>("/auth/logout", async (request, reply) => {
    const refreshToken = request.body?.refreshToken;
    if (refreshToken) revokeRefreshToken(hashRefreshToken(refreshToken));
    reply.code(204).send();
  });
}
