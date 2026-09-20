import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  publicBaseUrl: required("PUBLIC_BASE_URL").replace(/\/$/, ""),
  steamApiKey: required("STEAM_API_KEY"),
  jwtSecret: required("JWT_SECRET"),
  allowedSteamIds: (process.env.ALLOWED_STEAM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
};

export const isDev = config.nodeEnv === "development";
