import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/require-auth.js";

/**
 * Auto-update feed for the app (electron-updater "generic" provider): latest.yml, the installer
 * and its .blockmap, uploaded to /opt/hydra-server/updates at release time. Signed-in users only —
 * the installer stays private like the GitHub repo was. Only plain file names from that folder are
 * served (no sub-paths); @fastify/static's sendFile handles Range requests for resumable downloads.
 */
export const updatesDir = path.resolve(import.meta.dirname, "..", "..", "updates");
fs.mkdirSync(updatesDir, { recursive: true });

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function registerUpdateRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>("/updates/:file", async (request, reply) => {
    if (!requireAuth(request, reply)) return;

    const { file } = request.params;
    if (!SAFE_FILE.test(file) || file.includes("..")) {
      return reply.code(400).send({ message: "Invalid file" });
    }
    if (!fs.existsSync(path.join(updatesDir, file))) {
      return reply.code(404).send({ message: "Not found" });
    }

    // The feed manifest must never be cached, or clients would miss a new release.
    if (file.endsWith(".yml")) reply.header("Cache-Control", "no-store");
    return reply.sendFile(file, updatesDir);
  });
}
