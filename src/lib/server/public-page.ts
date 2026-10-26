/**
 * Fetching a public web page for an import (course websites, shared AI chats). The URL comes from
 * the student, so the server must not be steered into fetching something only it can reach:
 *
 * - Every hop (the URL and each redirect, at most `maxRedirects`) is checked before it's fetched:
 *   http(s) only, the caller's host rule, and every address its name resolves to must be public
 *   (no loopback, private, link-local, carrier-grade NAT or reserved ranges, in IPv4 or IPv6).
 * - The body is read inside the same time limit and refused past `maxBytes`, so a slow or huge
 *   page ends in a refusal, never a crash.
 *
 * What's left: the name is resolved here and again by `fetch`, so a DNS answer that changes between
 * the two (rebinding) isn't caught; pinning the address needs a custom dispatcher.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type PageRefusal =
  /** The URL, or a redirect, isn't one Orca will fetch (scheme, host or a non-public address). */
  | "blocked"
  /** The page couldn't be fetched or read in time, or answered with an error status. */
  | "unreachable"
  /** The answer isn't an HTML page. */
  | "not-html"
  /** The page is over `maxBytes`. */
  | "too-big";

export type PageResult = { ok: true; html: string; url: string } | { ok: false; reason: PageRefusal };

export interface PageOptions {
  /** Which hosts may be fetched (the first URL and every redirect); every public host when absent. */
  allowHost?: (host: string) => boolean;
  /** https only, or http too. */
  schemes?: readonly ("https:" | "http:")[];
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
}

const resolveAll = async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

function ipv4Public(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast and reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol assignments, documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** Whether an IP address is on the public internet. Anything that isn't a valid address is not. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return ipv4Public(ip);
  if (version !== 6) return false;
  const lower = ip.toLowerCase();
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return ipv4Public(mapped[1]);
  // Only global unicast (2000::/3) is public: that leaves out ::1, ::, other mapped and embedded
  // forms, NAT64, unique local (fc00::/7), link-local (fe80::/10) and multicast.
  const first = lower.startsWith(":") ? 0 : parseInt(lower.split(":")[0], 16);
  if ((first & 0xe000) !== 0x2000) return false;
  return !lower.startsWith("2001:db8:"); // documentation
}

async function hopAllowed(url: URL, options: PageOptions, lookup: (host: string) => Promise<string[]>): Promise<boolean> {
  const schemes = options.schemes ?? ["https:"];
  if (!(schemes as readonly string[]).includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (options.allowHost && !options.allowHost(host)) return false;
  if (isIP(host)) return isPublicAddress(host);
  try {
    const addresses = await lookup(host);
    return addresses.length > 0 && addresses.every(isPublicAddress);
  } catch {
    return false;
  }
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchPublicPage(input: string, options: PageOptions): Promise<PageResult> {
  const doFetch = options.fetch ?? fetch;
  const lookup = options.lookup ?? resolveAll;
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "blocked" };
  }
  try {
    for (let hop = 0; ; hop++) {
      if (!(await hopAllowed(url, options, lookup))) return { ok: false, reason: "blocked" };
      const response = await doFetch(url, { redirect: "manual", signal, headers: { "user-agent": options.userAgent, accept: "text/html" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location || hop >= maxRedirects) return { ok: false, reason: "unreachable" };
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) return { ok: false, reason: "unreachable" };
      if (!response.headers.get("content-type")?.includes("text/html")) return { ok: false, reason: "not-html" };
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too-big" };
      const html = response.body ? await readCapped(response.body, maxBytes) : "";
      if (html === null) return { ok: false, reason: "too-big" };
      return { ok: true, html, url: url.href };
    }
  } catch {
    // A network error, the time limit (while connecting or while reading the body) or a bad redirect.
    return { ok: false, reason: "unreachable" };
  }
}
