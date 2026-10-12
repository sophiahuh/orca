/**
 * Module resolution for unit tests that load server modules (routes, src/lib/server) under plain
 * Node: "@/x" → src/x, an extensionless relative import inside src → its .ts/.tsx file, and Next's
 * bare subpaths (next/headers, next/server, …) → their files, which Node's ESM resolver can't find
 * on its own. Pure modules keep their Node-loadable imports and don't need this; only tests that
 * exercise a route's own decisions (e.g. the 503 when Supabase isn't configured) rely on it.
 */
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const SRC = pathToFileURL(process.cwd() + "/src/").href;
const NEXT = pathToFileURL(process.cwd() + "/node_modules/next/").href;

function withExtension(base) {
  for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return base + ext;
  return base;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(withExtension(SRC + specifier.slice(2)), context);
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && context.parentURL?.startsWith(SRC)) {
    return next(withExtension(new URL(specifier, context.parentURL).href), context);
  }
  if (/^next\/(headers|server|navigation|cache)$/.test(specifier)) return next(`${NEXT}${specifier.slice(5)}.js`, context);
  return next(specifier, context);
}
