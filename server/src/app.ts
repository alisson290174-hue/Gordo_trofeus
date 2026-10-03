import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import "./db.js"; // side-effect: creates schema + seeds allowlist
import { registerAuthRoutes } from "./auth/routes.js";
import { registerProfileRoutes } from "./profile/routes.js";
import { registerUploadRoutes, uploadsDir } from "./uploads/routes.js";
import { registerDownloadSourceRoutes } from "./catalogue/download-sources-routes.js";
import { registerCatalogueRoutes } from "./catalogue/catalogue-routes.js";
import { registerLibraryRoutes } from "./library/routes.js";
import { registerAchievementRoutes } from "./achievements/routes.js";
import { registerSouvenirRoutes } from "./souvenirs/routes.js";
import { registerFriendRoutes } from "./friends/routes.js";
import { registerPublicProfileRoutes } from "./profile/public-routes.js";
import { registerCollectionRoutes } from "./collections/routes.js";
import { registerCloudSaveRoutes } from "./cloud-saves/routes.js";
import { registerRetroAchievementsRoutes } from "./integrations/retroachievements-routes.js";
import { registerPs3TrophyRoutes } from "./achievements/ps3-trophies.js";
import { registerSettingsRoutes } from "./settings/routes.js";
import { registerEmulationSaveRoutes } from "./emulation-saves/routes.js";
import { registerMiscRoutes } from "./misc-routes.js";
import { registerPs2Routes } from "./catalogue/ps2-routes.js";
import { registerArtworkLookupRoutes } from "./catalogue/artwork-lookup-routes.js";
import { registerUpdateRoutes } from "./updates/routes.js";
import { registerSteamOwnedRoutes } from "./profile/steam-owned-routes.js";

/**
 * Builds the HTTP app: hooks, parsers and every route — no port, no background jobs. index.ts
 * starts it for production; tests build the very same app and drive it with app.inject().
 */
export async function buildApp() {
  // maxParamLength defaults to 100, which is shorter than our signed cloud-save blob tokens
  // (~230 chars) — without this the PUT/GET /cloud-blobs/:token routes 404 on every real token.
  // Access logs mask capability tokens in URLs (upload / cloud-blob links, OpenID nonces).
  const redactUrl = (url: string) =>
    url
      .replace(/\/(uploads|cloud-blobs)\/[^/?#]+/g, "/$1/[token]")
      .replace(/([?&](?:openid\.[a-z_.]+|code|token|ext)=)[^&#]*/gi, "$1[redacted]");

  const app = Fastify({
    logger: {
      serializers: {
        req: (request) => ({
          method: request.method,
          url: redactUrl(request.url),
          remoteAddress: request.ip,
        }),
      },
    },
    routerOptions: { maxParamLength: 1024 },
  });

  // Baseline security headers on every response (API and /files images).
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");
    // Always served over HTTPS (Caddy): browsers must never fall back to plain HTTP.
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // JSON and images run nothing; the two HTML pages (sign-in) set their own, narrower policy.
    if (!reply.hasHeader("Content-Security-Policy")) {
      reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    }
    return payload;
  });

  // Raw buffer body for image uploads (PUT /uploads/:token); JSON stays the default for everything else.
  app.addContentTypeParser(
    ["image/png", "image/jpeg", "image/webp", "image/gif", "application/octet-stream"],
    { parseAs: "buffer" },
    (_request, payload, done) => done(null, payload)
  );

  // Some client calls (e.g. HydraApi.post(url, null)) send no body and no Content-Type at all —
  // Fastify has no parser for that by default and rejects with 415. Treat it as an empty body.
  app.addContentTypeParser("*", (_request, _payload, done) => done(null, undefined));

  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: "/files/",
  });

  registerAuthRoutes(app);
  registerProfileRoutes(app);
  registerUploadRoutes(app);
  registerDownloadSourceRoutes(app);
  registerCatalogueRoutes(app);
  registerLibraryRoutes(app);
  registerAchievementRoutes(app);
  registerSouvenirRoutes(app);
  registerFriendRoutes(app);
  registerPublicProfileRoutes(app);
  registerCollectionRoutes(app);
  registerCloudSaveRoutes(app);
  registerRetroAchievementsRoutes(app);
  registerPs3TrophyRoutes(app);
  registerSettingsRoutes(app);
  registerEmulationSaveRoutes(app);
  registerMiscRoutes(app);
  registerPs2Routes(app);
  registerArtworkLookupRoutes(app);
  registerUpdateRoutes(app);
  registerSteamOwnedRoutes(app);

  app.get("/health", async () => ({ ok: true }));
  return app;
}
