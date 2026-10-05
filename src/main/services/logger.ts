import { logsPath } from "@main/constants";
import log from "electron-log";
import path from "path";

type DepthAwareTransport = log.Transport & { depth: number };

const networkLog = log.create({ logId: "network" });
(networkLog.transports.ipc as DepthAwareTransport).depth = 12;
networkLog.transports.file.resolvePathFn = () =>
  path.join(logsPath, "network.txt");

log.transports.file.resolvePathFn = (
  _: log.PathVariables,
  message?: log.LogMessage | undefined
) => {
  if (message?.scope == "achievements") {
    return path.join(logsPath, "achievements.txt");
  }

  if (message?.level === "error") {
    return path.join(logsPath, "error.txt");
  }

  if (message?.level === "info") {
    return path.join(logsPath, "info.txt");
  }

  return path.join(logsPath, "logs.txt");
};

/**
 * Secrets never reach the log files: tokens in headers/objects and inside strings are masked
 * before any transport writes (logs are what users share when asking for help).
 */
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|password|secret|token|access_?token|refresh_?token|id_?token|api_?key|authorizationcode|code)$/i;
const SECRET_PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"],
  [
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    "[jwt redacted]",
  ],
  [
    /((?:access_token|refresh_token|token|code|key)=)[^&\s"']+/gi,
    "$1[redacted]",
  ],
  [
    /("?(?:authorizationCode|refreshToken|accessToken|refresh_token|access_token)"?\s*[:=]\s*"?)[^"',\s}]+/gi,
    "$1[redacted]",
  ],
  [/(--code\s+)\S+/g, "$1[redacted]"],
];

export const redactSecrets = (text: string) =>
  SECRET_PATTERNS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text
  );

const redactValue = (
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown => {
  if (typeof value === "string") return redactSecrets(value);
  if (!value || typeof value !== "object" || depth > 8) return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (value instanceof Error) {
    const error = new Error(redactSecrets(value.message));
    error.name = value.name;
    error.stack = value.stack ? redactSecrets(value.stack) : undefined;
    return error;
  }
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key)
      ? "[redacted]"
      : redactValue(item, depth + 1, seen);
  }
  return out;
};

const redactHook: log.Hook = (message) => {
  message.data = message.data.map((item) => redactValue(item));
  return message;
};
log.hooks.push(redactHook);
networkLog.hooks.push(redactHook);

log.errorHandler.startCatching({
  showDialog: false,
});

log.initialize();

export const logger = log.scope("main");
export const achievementsLogger = log.scope("achievements");
export const steamSyncLogger = log.scope("steam-sync");
export const networkLogger = networkLog.scope("network");
