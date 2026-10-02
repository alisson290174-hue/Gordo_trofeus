import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

/**
 * Fetch for user-supplied URLs (download-source feeds). Prevents SSRF: only https on the default
 * port, and the host must resolve exclusively to public addresses — no loopback, private ranges,
 * link-local (cloud metadata 169.254.169.254), CGNAT, documentation/test nets or IPv6 local ranges.
 *
 * DNS rebinding: the connection goes to the very address that was checked (custom `lookup`), so a
 * domain can't answer a public IP for the check and an internal one for the download. TLS is still
 * verified against the hostname (SNI + certificate), so pinning the IP can't be used to impersonate.
 * Body size is capped.
 */
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

const isPrivateIPv4 = (ip: string) => {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const isPrivateIPv6 = (ip: string) => {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) return isPrivateIPv4(lower.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff|2001:db8)/.test(lower);
};

export const isPublicAddress = (ip: string) =>
  net.isIPv4(ip) ? !isPrivateIPv4(ip) : net.isIPv6(ip) ? !isPrivateIPv6(ip) : false;

export interface VerifiedUrl {
  url: URL;
  address: string;
  family: 4 | 6;
}

export async function assertSafePublicUrl(raw: string): Promise<VerifiedUrl> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only https URLs are allowed");
  if (url.port && url.port !== "443") throw new Error("Non-standard ports are not allowed");
  if (url.username || url.password) throw new Error("Credentials in URL are not allowed");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new Error("URL resolves to a non-public address");
  }
  const address = addresses[0];
  return { url, address, family: net.isIPv6(address) ? 6 : 4 };
}

interface PinnedResponse {
  status: number;
  location: string | null;
  body: Buffer;
}

/** HTTPS GET that connects only to the pre-verified address. */
function getPinned({ url, address, family }: VerifiedUrl): Promise<PinnedResponse> {
  // Node may ask for one address or (autoSelectFamily) a list — answer both with the checked IP.
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean })?.all) {
      (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address, family },
      ]);
    } else {
      callback(null, address, family);
    }
  };

  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        host: url.hostname,
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        headers: { accept: "application/json", "user-agent": "BaloiServer/1.0" },
        lookup,
        timeout: TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location ?? null;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > MAX_BYTES) {
          response.destroy();
          reject(new Error("Feed too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            response.destroy();
            reject(new Error("Feed too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, location, body: Buffer.concat(chunks) }));
        response.on("error", reject);
      }
    );
    request.on("timeout", () => request.destroy(new Error("Timed out")));
    request.on("error", reject);
  });
}

/** GETs JSON from a validated public https URL; redirects are re-validated (max 3). */
export async function safeFetchJson(raw: string, redirects = 0): Promise<unknown> {
  const verified = await assertSafePublicUrl(raw);
  const response = await getPinned(verified);

  if (response.status >= 300 && response.status < 400) {
    if (!response.location) throw new Error("Redirect without location");
    if (redirects >= 3) throw new Error("Too many redirects");
    // Feeds are often behind a CDN / GitHub raw redirect: each hop is checked and pinned again.
    return safeFetchJson(new URL(response.location, verified.url).toString(), redirects + 1);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

  return JSON.parse(response.body.toString("utf8"));
}
