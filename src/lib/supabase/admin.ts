// Service-role-keyed Supabase client for server-side admin contexts
// (Inngest functions, server actions that bypass RLS).
// NEVER import from a Client Component — the service_role key is server-only.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { getAdminEnv } from "@/lib/env";

let cached: SupabaseClient<Database> | undefined;

export function adminClient(): SupabaseClient<Database> {
  if (!cached) {
    const env = getAdminEnv();
    cached = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }
  return cached;
}
