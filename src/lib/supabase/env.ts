/**
 * Supabase settings from the environment (names in `.env.example`). Missing ones are an error the
 * caller shows ("Orca isn't connected to its database"), never a fallback to something else.
 */
export class SupabaseNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Orca isn't connected to its database: set ${missing.join(", ")} (see .env.example)`);
    this.name = "SupabaseNotConfiguredError";
  }
}

function read(names: string[]): string[] {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new SupabaseNotConfiguredError(missing);
  return names.map((n) => process.env[n]!);
}

/** The project URL and publishable key, which the browser may see too. */
export function publicSupabaseEnv(): { url: string; publishableKey: string } {
  // Spelled out (not through `read`) so Next can inline NEXT_PUBLIC_ values into browser bundles.
  const values = { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new SupabaseNotConfiguredError(missing);
  return { url: values.NEXT_PUBLIC_SUPABASE_URL!, publishableKey: values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! };
}

/** The secret key too. Server only: it bypasses row-level security. */
export function serverSupabaseEnv(): { url: string; publishableKey: string; secretKey: string } {
  const [url, publishableKey, secretKey] = read(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]);
  return { url, publishableKey, secretKey };
}
