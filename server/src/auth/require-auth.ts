import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "./jwt.js";
import { getUserById, type UserRow } from "../users.js";

/** Verifies the Authorization: Bearer header and loads the acting user, or replies 401. */
export function requireAuth(request: FastifyRequest, reply: FastifyReply): UserRow | null {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    reply.code(401).send({ message: "Missing Authorization header" });
    return null;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = getUserById(payload.sub);
    if (!user) {
      reply.code(401).send({ message: "User not found" });
      return null;
    }
    return user;
  } catch {
    reply.code(401).send({ message: "Invalid or expired access token" });
    return null;
  }
}
