import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
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
import { registerMiscRoutes } from "./misc-routes.js";

const app = Fastify({ logger: true });

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
registerMiscRoutes(app);

app.get("/health", async () => ({ ok: true }));

const HOST = "127.0.0.1"; // Caddy is the only public-facing listener in production.

app
  .listen({ port: config.port, host: HOST })
  .then(() => app.log.info(`Hydra personal server listening on ${HOST}:${config.port}`))
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
