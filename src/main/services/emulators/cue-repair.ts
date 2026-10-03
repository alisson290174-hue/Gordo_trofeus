import fs from "node:fs";
import path from "node:path";

import { logger } from "../logger";
import { repairCueText } from "./cue-repair-rules";

export { cueBaseName, repairCueText } from "./cue-repair-rules";

/**
 * Some download sites rename a disc's .bin but leave its .cue pointing at the old name, so the
 * emulator can't open the game. When a single-file .cue points at a missing file and a .bin named
 * like the .cue itself sits next to it, point the .cue at that .bin (original kept as .cue.bak).
 */

const listCues = (dir: string, recursive: boolean): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) out.push(...listCues(full, recursive));
    else if (entry.isFile() && /\.cue$/i.test(entry.name)) out.push(full);
  }
  return out;
};

export const repairCuesInFolder = (folder: string, recursive: boolean): number => {
  let repaired = 0;
  let cues: string[] = [];
  try {
    cues = listCues(folder, recursive);
  } catch {
    return 0;
  }
  for (const cuePath of cues) {
    try {
      const dir = path.dirname(cuePath);
      const text = fs.readFileSync(cuePath, "utf8");
      const fixed = repairCueText(text, path.basename(cuePath), (name) =>
        fs.existsSync(path.join(dir, name))
      );
      if (!fixed) continue;
      const backup = `${cuePath}.bak`;
      if (!fs.existsSync(backup)) fs.copyFileSync(cuePath, backup);
      fs.writeFileSync(cuePath, fixed, "utf8");
      repaired += 1;
      logger.info("[cue-repair] fixed", { cuePath });
    } catch (error) {
      logger.warn("[cue-repair] could not fix", { cuePath, error: String(error) });
    }
  }
  return repaired;
};
