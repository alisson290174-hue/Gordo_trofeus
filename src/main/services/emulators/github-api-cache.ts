import axios from "axios";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { logger } from "../logger";

/**
 * GitHub allows 60 anonymous API calls an hour per IP, and the update check, the emulators
 * screen and every app restart all ask for the same handful of releases. Answers are kept on
 * disk: fresh ones are reused without a request, older ones are revalidated with an ETag (a 304
 * doesn't count against the limit) and a refused or failed request falls back to the last good
 * answer instead of leaving the emulator without a download link.
 */

const API = "https://api.github.com";
const TIMEOUT_MS = 15_000;
const FRESH_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  etag: string | null;
  fetchedAt: number;
  data: unknown;
}

let cache: Record<string, CacheEntry> | null = null;

const cacheFile = () =>
  path.join(app.getPath("userData"), "github-api-cache.json");

const loadCache = () => {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
  } catch {
    cache = {};
  }
  return cache!;
};

const saveCache = () => {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(cache));
  } catch (error) {
    logger.warn("[github-cache] could not save", error);
  }
};

/** GET `${API}${apiPath}`; throws only when there is neither an answer nor a cached copy. */
export const githubGet = async <T>(apiPath: string): Promise<T> => {
  const entries = loadCache();
  const cached = entries[apiPath];
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    return cached.data as T;
  }

  try {
    const response = await axios.get<T>(`${API}${apiPath}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "OpusLauncher",
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      },
      timeout: TIMEOUT_MS,
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 304,
    });

    if (response.status === 304 && cached) {
      cached.fetchedAt = Date.now();
      saveCache();
      return cached.data as T;
    }

    entries[apiPath] = {
      etag: (response.headers.etag as string | undefined) ?? null,
      fetchedAt: Date.now(),
      data: response.data,
    };
    saveCache();
    return response.data;
  } catch (error) {
    if (cached) {
      logger.warn(`[github-cache] ${apiPath} failed, using the saved answer`);
      return cached.data as T;
    }
    throw error;
  }
};
