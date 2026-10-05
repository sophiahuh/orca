/**
 * The Content-Security-Policy `src/proxy.ts` sends with every page. Generated text (questions,
 * objectives, notes) is only ever rendered as React text, and this is the second layer: injected
 * markup couldn't run even if it slipped through. Scripts need the per-request nonce (Next puts it
 * on its own scripts); styles allow inline because React and `motion` write style attributes.
 * Nothing may be framed, and forms post only to this site. Pure, so `npm test` covers it.
 *
 * Browser-direct model calls (Settings → "Your AI") are not allowed here; Phase 4 removes them.
 */
export function contentSecurityPolicy(opts: { nonce: string; supabaseUrl?: string; dev: boolean }): string {
  const connect = ["'self'"];
  if (opts.supabaseUrl) {
    const u = new URL(opts.supabaseUrl);
    connect.push(u.origin, `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`);
  }
  if (opts.dev) connect.push("ws:", "http://localhost:*", "http://127.0.0.1:*");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
