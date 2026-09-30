import dns from "node:dns/promises";
import net from "node:net";

/**
 * Fetch for user-supplied URLs (download-source feeds). Prevents SSRF: only https on the default
 * port, and the host must resolve exclusively to public addresses — no loopback, private ranges,
 * link-local (cloud metadata 169.254.169.254), CGNAT or IPv6 local ranges. Body size is capped.
 */
const MAX_BYTES = 25 * 1024 * 1024;

const isPrivateIPv4 = (ip: string) => {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isPrivateIPv6 = (ip: string) => {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) return isPrivateIPv4(lower.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
};

export const isPublicAddress = (ip: string) =>
  net.isIPv4(ip) ? !isPrivateIPv4(ip) : net.isIPv6(ip) ? !isPrivateIPv6(ip) : false;

export async function assertSafePublicUrl(raw: string): Promise<URL> {
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
  return url;
}

/** GETs JSON from a validated public https URL, without following redirects to other hosts. */
export async function safeFetchJson(raw: string, redirects = 0): Promise<unknown> {
  const url = await assertSafePublicUrl(raw);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json" },
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect without location");
    if (redirects >= 3) throw new Error("Too many redirects");
    // One redirect, re-validated (feeds are often behind a CDN / GitHub raw redirect).
    const next = await assertSafePublicUrl(new URL(location, url).toString());
    return safeFetchJson(next.toString(), redirects + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("Feed too large");

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("Feed too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
