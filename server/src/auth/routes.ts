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

/**
 * Shown in the sign-in window when the Steam account isn't invited yet. It shows the visitor's own
 * SteamID64 (digits only, already validated) so they can send it to the owner to be allowed.
 */
function restrictedAccessPage(steamId?: string | null): string {
  const id = steamId && /^\d{17}$/.test(steamId) ? steamId : null;
  const idBlock = id
    ? `<p>Envie este Steam ID para quem te convidou liberar o seu acesso:</p>
       <div class="id" id="id">${id}</div>
       <button onclick="navigator.clipboard.writeText('${id}').then(()=>{this.textContent='Copiado!'})">Copiar Steam ID</button>
       <p class="hint">Depois de liberado, é só clicar em "Entrar com a Steam" de novo.</p>`
    : `<p>Não foi possível confirmar a sua conta Steam. Feche esta janela e tente entrar de novo.</p>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Balói — acesso restrito</title>
    <style>
      body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:#0b1120;color:#e6ebf5;font-family:"Segoe UI",system-ui,sans-serif;text-align:center}
      main{max-width:440px;padding:32px}
      h1{font-size:22px;font-weight:600;margin:0 0 12px}
      p{color:#a8b3c7;line-height:1.5;margin:0 0 16px}
      .id{font-family:Consolas,monospace;font-size:22px;letter-spacing:1px;padding:12px 16px;margin:0 0 16px;
        border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);user-select:all}
      button{padding:10px 20px;border-radius:999px;border:0;background:#2f6bff;color:#fff;font-size:14px;cursor:pointer}
      .hint{margin-top:16px;font-size:13px}
    </style></head>
    <body><main><h1>Acesso só por convite</h1>${idBlock}</main></body></html>`;
}

/** CSP for the two small HTML pages: their own inline style/script only, nothing from elsewhere. */
const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'";

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
      return reply.code(401).header("Content-Security-Policy", PAGE_CSP).type("text/html").send(restrictedAccessPage());
    }

    const steamId = extractSteamId64(claimedIdentifier);
    if (!steamId || !isSteamIdAllowedToLogin(steamId)) {
      return reply
        .code(403)
        .header("Content-Security-Policy", PAGE_CSP)
        .type("text/html")
        .send(restrictedAccessPage(steamId));
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

    reply.header("Content-Security-Policy", PAGE_CSP).type("text/html").send(redirectToAppPage(payload));
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
