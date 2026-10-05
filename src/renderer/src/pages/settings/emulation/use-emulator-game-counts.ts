import { useEffect, useState } from "react";
import type { EmulatorSystem } from "@types";

/**
 * Games actually in the library per system (multi-disc sets and duplicate dumps count once).
 * The config's totalFiles counts ROM files, which is right for storage but overstates games.
 */
export function useEmulatorGameCounts(
  systems: readonly EmulatorSystem[],
  nonce: unknown
) {
  const [counts, setCounts] = useState<Partial<Record<EmulatorSystem, number>>>(
    {}
  );
  const key = systems.join(",");

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      systems.map((system) =>
        window.electron
          .listEmulatorRoms(system)
          .then((roms) => [system, roms.length] as const)
          .catch(() => [system, undefined] as const)
      )
    ).then((entries) => {
      if (cancelled) return;
      const next: Partial<Record<EmulatorSystem, number>> = {};
      for (const [system, count] of entries)
        if (count !== undefined) next[system] = count;
      setCounts(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return counts;
}
