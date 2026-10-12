"use client";

/** The browser's Supabase client: the session lives in cookies (`@supabase/ssr`), the same ones the server reads. */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function browserSupabase() {
  if (!client) {
    const { url, publishableKey } = publicSupabaseEnv();
    client = createBrowserClient<Database>(url, publishableKey);
  }
  return client;
}
