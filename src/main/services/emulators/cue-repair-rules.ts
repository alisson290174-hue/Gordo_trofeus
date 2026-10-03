/** Pure rules of the .cue repair (no Electron/logger imports, unit-tested). */

/** "Game (BR).cue" or "Game (BR).cue.cue" → "Game (BR)". */
export const cueBaseName = (cueFileName: string) => cueFileName.replace(/(\.cue)+$/i, "");

/** Pure: the repaired .cue text, or null when it's fine or can't be repaired safely. */
export const repairCueText = (
  cueText: string,
  cueFileName: string,
  exists: (fileName: string) => boolean
): string | null => {
  const files = [...cueText.matchAll(/^\s*FILE\s+"([^"]+)"/gim)];
  if (files.length !== 1) return null; // multi-file (one .bin per track): leave alone
  const current = files[0][1];
  if (exists(current)) return null;
  const candidate = `${cueBaseName(cueFileName)}.bin`;
  if (!exists(candidate)) return null;
  return cueText.replace(files[0][0], files[0][0].replace(current, candidate));
};

