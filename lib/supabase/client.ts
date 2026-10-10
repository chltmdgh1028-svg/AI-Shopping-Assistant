"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createSupabaseBrowserClient() {
  const env = getSupabaseBrowserEnv();
  if (!env) return null;
  browserClient ??= createBrowserClient<Database>(env.url, env.key);
  return browserClient;
}
