import { useEffect, useState } from "react";
import type { EpicInstallState } from "@types";

/** Live Epic install progress (all games), fed by the main process' Legendary runs. */
export function useEpicInstalls() {
  const [installs, setInstalls] = useState<Record<string, EpicInstallState>>({});

  useEffect(() => {
    let alive = true;
    window.electron.getEpicInstalls().then((list) => {
      if (!alive) return;
      setInstalls(Object.fromEntries(list.map((state) => [state.appName, state])));
    });

    const unsubscribe = window.electron.onEpicInstallProgress((state) => {
      setInstalls((prev) => {
        const next = { ...prev, [state.appName]: state };
        // Finished runs leave the list shortly after, so "done"/"cancelled" don't linger.
        if (state.status === "done" || state.status === "cancelled") delete next[state.appName];
        return next;
      });
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return installs;
}
