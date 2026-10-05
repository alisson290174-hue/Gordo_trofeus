/** First dotted number in a version/tag string: "v2.2.0" → [2,2,0], "0.0.43-20184-d5213de6" → [0,0,43]. */
export const versionNumbers = (
  value: string | null | undefined
): number[] | null => {
  const match = /\d+(?:\.\d+)+/.exec(value ?? "");
  return match ? match[0].split(".").map(Number) : null;
};

const compareNumbers = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

export type UpdateDecision = "update" | "up_to_date" | "adopt";

/**
 * Should the emulator be replaced by the release tagged `latestTag`?
 * - `installedTag` is the release Opus installed last time (exact match = up to date).
 * - Without it (installed by hand or by an older Opus) the version numbers are compared; when they
 *   can't be ("latest" rolling tags, builds without a number) the current release is adopted as the
 *   baseline, so nothing is reinstalled blindly and the next new tag is picked up.
 */
export const decideEmulatorUpdate = (params: {
  installedTag: string | null | undefined;
  installedVersion: string | null | undefined;
  latestTag: string;
}): UpdateDecision => {
  const { installedTag, installedVersion, latestTag } = params;
  if (installedTag) return installedTag === latestTag ? "up_to_date" : "update";
  const installed = versionNumbers(installedVersion);
  const latest = versionNumbers(latestTag);
  if (!installed || !latest) return "adopt";
  return compareNumbers(latest, installed) > 0 ? "update" : "adopt";
};
