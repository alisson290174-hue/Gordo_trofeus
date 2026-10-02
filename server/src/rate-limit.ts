/**
 * Minimal in-memory sliding-window limiter for routes that call third-party APIs on the caller's
 * behalf (Steam store / Web API). Protects the server's Steam key quota and the VPS IP from being
 * rate-limited by Steam. Single process, so memory is enough; counters reset on restart.
 */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);

    // Keep the map from growing with idle keys.
    if (hits.size > 1000) {
      for (const [entryKey, times] of hits) {
        if (times.every((time) => now - time >= windowMs)) hits.delete(entryKey);
      }
    }
    return true;
  };
}
