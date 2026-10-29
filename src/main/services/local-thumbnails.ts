import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { logger } from "./logger";

/**
 * Covers from the art backup (D:\EMULADORES\Artes) are scans up to 4000 px wide, shown in tiles
 * ~300 px wide: decoding them made the Big Picture strip stutter and left grey tiles while they
 * loaded. A "local:...?w=600" request gets a WebP of that width instead, made once and kept in
 * userData/thumbnails (rebuilt when the original changes).
 */

const THUMBNAIL_FORMATS = /\.(png|jpe?g|webp|bmp|avif)$/i;
const ALLOWED_WIDTHS = [300, 600, 900, 1200];
const inflight = new Map<string, Promise<string | null>>();

const thumbnailsDir = () => path.join(app.getPath("userData"), "thumbnails");

export const pickThumbnailWidth = (requested: number) =>
  ALLOWED_WIDTHS.find((width) => width >= requested) ?? ALLOWED_WIDTHS.at(-1)!;

/** Path of a cached thumbnail for `filePath` at `width`, creating it if needed (null = use the original). */
export const getLocalThumbnail = async (filePath: string, width: number) => {
  if (!THUMBNAIL_FORMATS.test(filePath)) return null;

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }

  const key = crypto
    .createHash("sha1")
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}|${width}`)
    .digest("hex");
  const target = path.join(thumbnailsDir(), `${key}.webp`);
  if (fs.existsSync(target)) return target;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      await fs.promises.mkdir(thumbnailsDir(), { recursive: true });
      const image = sharp(filePath, { failOn: "none" });
      const { width: original } = await image.metadata();
      // Already small: the original is fine.
      if (original && original <= width) return null;
      await image
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 86 })
        .toFile(target);
      return target;
    } catch (error) {
      logger.warn(`[thumbnails] could not shrink ${filePath}`, error);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
};
