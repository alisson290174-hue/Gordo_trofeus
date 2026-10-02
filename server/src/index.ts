import { config } from "./config.js";
import "./db.js"; // side-effect: creates schema + seeds allowlist
import { buildApp } from "./app.js";
import { cleanupStaleCloudSaves } from "./cloud-saves/cleanup.js";
import { scheduleDailyBackup } from "./backup.js";
import {
  requeueGamesForReviewCountIfNeeded,
  requeueUntranslatedGamesIfNeeded,
  seedAppIdQueueIfNeeded,
  startSteamCatalogueSyncLoop,
} from "./catalogue/steam-catalogue-sync.js";

const app = await buildApp();
scheduleDailyBackup();

const HOST = "127.0.0.1"; // Caddy is the only public-facing listener in production.

await seedAppIdQueueIfNeeded();
requeueUntranslatedGamesIfNeeded();
requeueGamesForReviewCountIfNeeded();
startSteamCatalogueSyncLoop();
cleanupStaleCloudSaves();

app
  .listen({ port: config.port, host: HOST })
  .then(() => app.log.info(`Hydra personal server listening on ${HOST}:${config.port}`))
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
