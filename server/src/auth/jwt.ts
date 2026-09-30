import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
export const REFRESH_TOKEN_TTL_DAYS = 60;

export interface AccessTokenPayload {
  sub: string;
  steamId: string;
  sessionId: string;
}

export function signAccessToken(userId: string, steamId: string) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sub: userId, steamId, sessionId } satisfies AccessTokenPayload,
    config.jwtSecret,
    { algorithm: "HS256", expiresIn: ACCESS_TOKEN_TTL_SECONDS }
  );
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pin the algorithm: we only ever sign with HS256, so accepting anything else (or "none")
  // would only widen the attack surface (algorithm-confusion / alg:none forgeries).
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ["HS256"],
  }) as AccessTokenPayload;
}

export function generateRefreshToken() {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = hashRefreshToken(raw);
  return { raw, hash };
}

export function hashRefreshToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
