import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";
import { getBrowserEnv } from "@/lib/env";

export function createClient() {
  const env = getBrowserEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
