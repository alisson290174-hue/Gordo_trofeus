import type { UserPreferences } from "@types";
import { useEffect, useState } from "react";

type ElectronPreferencesBridge = {
  getUserPreferences?: () => Promise<UserPreferences | null>;
  onUserPreferencesUpdated?: (
    cb: (preferences: UserPreferences | null) => void
  ) => () => void;
};

/**
 * One shared copy of the preferences for the whole window. Every library card used to fetch them
 * (and subscribe) on its own: ~565 IPC round trips each time the library opened, which froze Big
 * Picture for seconds and delayed the next screen. Now: one fetch, one IPC listener.
 */
let lastKnownPreferences: UserPreferences | null = null;
let hasLoaded = false;
let loading: Promise<void> | null = null;
let ipcUnsubscribe: (() => void) | null = null;
const listeners = new Set<(preferences: UserPreferences | null) => void>();

const publish = (preferences: UserPreferences | null) => {
  lastKnownPreferences = preferences;
  hasLoaded = true;
  for (const listener of listeners) listener(preferences);
};

const ensureLoaded = () => {
  const electron = globalThis.window?.electron as
    ElectronPreferencesBridge | undefined;

  if (
    !ipcUnsubscribe &&
    typeof electron?.onUserPreferencesUpdated === "function"
  ) {
    ipcUnsubscribe = electron.onUserPreferencesUpdated(publish);
  }

  if (hasLoaded || loading) return;
  if (typeof electron?.getUserPreferences !== "function") {
    publish(null);
    return;
  }

  loading = electron
    .getUserPreferences()
    .then(publish, () => publish(null))
    .finally(() => {
      loading = null;
    });
};

export function useUserPreferences() {
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(() => lastKnownPreferences);

  useEffect(() => {
    listeners.add(setUserPreferences);
    ensureLoaded();
    // A value that arrived between the first render and this effect.
    if (hasLoaded) setUserPreferences(lastKnownPreferences);
    return () => {
      listeners.delete(setUserPreferences);
    };
  }, []);

  return userPreferences;
}
