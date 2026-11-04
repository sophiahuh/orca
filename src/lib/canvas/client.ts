/**
 * A small Canvas REST client: bearer token, JSON, `Link`-header pagination, and a file download
 * that follows Canvas's signed redirect to storage without sending the token along. Pure apart
 * from the `fetch` it's given (tests pass a fake).
 */
import { parseNextLink } from "./api.ts";

export class CanvasError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CanvasError";
    this.status = status;
  }
}

export interface CanvasClientOptions {
  /** The site's origin, e.g. https://courseworks2.columbia.edu (no path). */
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Most pages followed for one list (100 items each). */
  maxPages?: number;
  timeoutMs?: number;
}

export interface CanvasClient {
  /** GET /api/v1<path>, one page. */
  get<T>(path: string, params?: Record<string, string | string[]>): Promise<T>;
  /** GET /api/v1<path>, every page. */
  getAll<T>(path: string, params?: Record<string, string | string[]>): Promise<T[]>;
  /** The bytes of a file from its download URL, refused past `maxBytes`. */
  download(url: string, maxBytes: number): Promise<Uint8Array>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function withParams(url: URL, params: Record<string, string | string[]> | undefined) {
  for (const [k, v] of Object.entries(params ?? {})) {
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, x);
    else url.searchParams.set(k, v);
  }
  return url;
}

export function canvasClient(options: CanvasClientOptions): CanvasClient {
  const doFetch = options.fetch ?? fetch;
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.username) throw new CanvasError(400, "The Canvas site must be an https address with no path, like https://courseworks2.columbia.edu.");
  const maxPages = options.maxPages ?? 20;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const auth = { authorization: `Bearer ${options.token}`, accept: "application/json" };

  const page = async <T>(url: URL): Promise<{ body: T; next: string | null }> => {
    const res = await doFetch(url, { headers: auth, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401) throw new CanvasError(401, "Canvas didn't accept the token.");
    if (res.status === 403 || res.status === 404) throw new CanvasError(res.status, `Canvas wouldn't show ${url.pathname} (${res.status}).`);
    if (!res.ok) throw new CanvasError(res.status, `Canvas answered ${res.status} for ${url.pathname}.`);
    const next = parseNextLink(res.headers.get("link"));
    return { body: (await res.json()) as T, next };
  };

  const apiUrl = (path: string, params?: Record<string, string | string[]>) => withParams(new URL(`/api/v1${path}`, base), params);

  return {
    async get<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
      return (await page<T>(apiUrl(path, params))).body;
    },

    async getAll<T>(path: string, params?: Record<string, string | string[]>): Promise<T[]> {
      const out: T[] = [];
      let url: URL | null = apiUrl(path, { per_page: "100", ...params });
      for (let n = 0; url && n < maxPages; n++) {
        const got: { body: T[]; next: string | null } = await page<T[]>(url);
        if (!Array.isArray(got.body)) throw new CanvasError(502, `Canvas answered ${path} with something that isn't a list.`);
        out.push(...got.body);
        url = got.next ? new URL(got.next, base) : null;
        if (url && url.origin !== base.origin) throw new CanvasError(502, "Canvas pointed the next page at another site.");
      }
      return out;
    },

    async download(url: string, maxBytes: number): Promise<Uint8Array> {
      let target = new URL(url);
      if (target.origin !== base.origin) throw new CanvasError(502, "The file's download link isn't on the Canvas site.");
      // The first hop is Canvas (needs the token); it redirects to storage, which must not see the token.
      let res = await doFetch(target, { headers: auth, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 5; hops++) {
        const location = res.headers.get("location");
        if (!location) break;
        target = new URL(location, target);
        if (target.protocol !== "https:") throw new CanvasError(502, "The file's download link left https.");
        res = await doFetch(target, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      }
      if (!res.ok) throw new CanvasError(res.status, `Canvas wouldn't hand over the file (${res.status}).`);
      const length = Number(res.headers.get("content-length") ?? "0");
      if (length > maxBytes) throw new CanvasError(413, "The file is too big.");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new CanvasError(413, "The file is too big.");
      return bytes;
    },
  };
}
