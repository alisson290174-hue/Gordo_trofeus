import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/require-auth.js";
import { toUserDetails, updateUserProfile, type ProfileUpdate } from "../users.js";

export function registerProfileRoutes(app: FastifyInstance) {
  app.get("/profile/me", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;
    reply.send(toUserDetails(user));
  });

  app.patch<{ Body: ProfileUpdate }>("/profile", async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const updated = updateUserProfile(user.id, request.body ?? {});
    reply.send(toUserDetails(updated));
  });
}
