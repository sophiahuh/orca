/**
 * Where emailed links point (Phase 4 plan, Task 4 review). Confirmation and reset links carry a
 * `redirect_to` back to Orca; building it from the request's Host header let a request with a
 * forged Host send a student a link to another site. The address now comes from `SITE_URL`.
 * Development may still fall back to the request's host (a local stack has no fixed address);
 * production never does: without `SITE_URL` no link is sent and the form says so. Pure.
 */

export class SiteUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteUrlError";
  }
}

export interface OriginInput {
  /** `SITE_URL` from the environment, if set. */
  siteUrl: string | undefined;
  /** Whether this is a production build (`NODE_ENV`). */
  production: boolean;
  /** The request's host and scheme, used only in development. */
  host?: string | null;
  proto?: string | null;
}

/** The site's origin for links: `SITE_URL` cleaned up (scheme and host, no path), or in development the request's. */
export function linkOrigin({ siteUrl, production, host, proto }: OriginInput): string {
  if (siteUrl) {
    let url: URL;
    try {
      url = new URL(siteUrl.trim());
    } catch {
      throw new SiteUrlError(`SITE_URL isn't a valid URL (${siteUrl}); set it to the site's address, e.g. https://orca.example.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new SiteUrlError(`SITE_URL must start with https:// (got ${url.protocol}).`);
    if (production && url.protocol !== "https:" && !isLocal(url.hostname)) throw new SiteUrlError("SITE_URL must use https in production.");
    return url.origin;
  }
  if (production) throw new SiteUrlError("SITE_URL isn't set: Orca won't build email links from the request's Host header in production.");
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) throw new SiteUrlError("No usable Host header to build a link from; set SITE_URL.");
  const scheme = proto === "https" || proto === "http" ? proto : isLocal(host.split(":")[0]) ? "http" : "https";
  return `${scheme}://${host}`;
}

const isLocal = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

/** The configured site URL, read from the environment. */
export function siteUrl(): string | undefined {
  return process.env.SITE_URL || undefined;
}
