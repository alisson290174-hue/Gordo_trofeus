import type { FastifyInstance } from "fastify";

/**
 * Small, deliberately-empty endpoints for features that are out of scope for this personal
 * server (reviews, How Long To Beat, real cloud-save sync, cross-device download-source sync,
 * a notification inbox, badges, feature flags, real Steam account import). Every one of these
 * used to 404, which the client mostly already tolerates — but a clean empty response is quieter
 * in the logs and matches the shape the client actually expects instead of an error path.
 */
export function registerMiscRoutes(app: FastifyInstance) {
  app.get("/badges", async (_request, reply) => reply.send([]));
  app.get("/features", async (_request, reply) => reply.send([]));

  app.get("/profile/notifications", async (_request, reply) =>
    reply.send({ notifications: [], pagination: { total: 0, take: 20, skip: 0, hasMore: false } })
  );
  app.get("/profile/notifications/count", async (_request, reply) =>
    reply.send({ count: 0 })
  );
  // The inbox is always empty here (the app keeps its own local notifications), but "mark all
  // as read" / "clear all" still call these and showed an error when they 404'd.
  app.patch("/profile/notifications/:id/read", async (_request, reply) => reply.send({}));
  app.delete("/profile/notifications/:id", async (_request, reply) => reply.send({}));

  app.get("/profile/integrations/steam", async (_request, reply) =>
    reply.send({ connected: false, snapshotPreserved: false })
  );

  // /profile/cloud-saves/* is now served for real by registerCloudSaveRoutes.
  app.get("/profile/games/artifacts", async (_request, reply) => reply.send([]));
  app.get("/profile/download-sources", async (_request, reply) => reply.send([]));

  app.get("/games/:shop/:objectId/reviews", async (_request, reply) =>
    reply.send({ reviews: [], totalCount: 0 })
  );
  app.get("/games/:shop/:objectId/reviews/check", async (_request, reply) =>
    reply.send({ hasReviewed: false })
  );
  app.get("/games/:shop/:objectId/how-long-to-beat", async (_request, reply) =>
    reply.send([])
  );
  app.get("/users/:id/reviews", async (_request, reply) =>
    reply.send({ reviews: [], totalCount: 0 })
  );
}
