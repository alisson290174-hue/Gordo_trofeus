/**
 * Opus's own link scheme. "hydralauncher://" belongs to the official Hydra app, so Opus no longer
 * registers it with Windows (that could open links meant for one app in the other), but still
 * accepts it: desktop shortcuts created before the switch pass "hydralauncher://run?..." as an
 * argument, and the server's sign-in callback still uses it.
 */
export const DEEP_LINK_SCHEME = "opuslauncher";

const ACCEPTED_PREFIXES = [`${DEEP_LINK_SCHEME}://`, "hydralauncher://"];
const ACCEPTED_PROTOCOLS = new Set([`${DEEP_LINK_SCHEME}:`, "hydralauncher:"]);

export const buildDeepLink = (pathAndQuery: string) =>
  `${DEEP_LINK_SCHEME}://${pathAndQuery}`;

/** True for any Opus deep link; with `target`, only for that host (e.g. "run", "auth"). */
export const isDeepLink = (url: string | undefined, target?: string) =>
  Boolean(url) &&
  ACCEPTED_PREFIXES.some((prefix) => url!.startsWith(prefix + (target ?? "")));

export const isDeepLinkProtocol = (protocol: string) =>
  ACCEPTED_PROTOCOLS.has(protocol);
