import { z } from "zod";

// Auth env — what middleware and SSR auth helpers need. Kept minimal so a
// missing Phase 2+ key (Voyage, etc.) doesn't take down the auth middleware
// and 500 every page on Vercel.
const AuthEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

// Admin env — what server-side DB writes / RLS-bypassing reads need.
// Doesn't include external-service keys (Voyage, etc.), so a missing
// VOYAGE_API_KEY on a deploy doesn't take down the home page.
const AdminEnvSchema = AuthEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

// Server env — full set including external-service keys. Used only by code
// paths that actually call external APIs (Voyage embed, Claude, etc.).
// Splitting this out means a missing key fails only the relevant feature,
// not the whole site.
const ServerEnvSchema = AdminEnvSchema.extend({
  VOYAGE_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  LLAMAPARSE_API_KEY: z.string().min(1),
});

const BrowserEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

let cachedAuthEnv: z.infer<typeof AuthEnvSchema> | undefined;
let cachedAdminEnv: z.infer<typeof AdminEnvSchema> | undefined;
let cachedServerEnv: z.infer<typeof ServerEnvSchema> | undefined;
let cachedBrowserEnv: z.infer<typeof BrowserEnvSchema> | undefined;

/**
 * Validates only the auth-related env (Supabase URL + anon key). Use this in
 * middleware and SSR auth client factories — anywhere that doesn't need the
 * service role key or external API keys.
 */
export function getAuthEnv() {
  if (!cachedAuthEnv) {
    cachedAuthEnv = AuthEnvSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return cachedAuthEnv;
}

/**
 * Validates auth + service-role keys. Use this for admin Supabase clients
 * (RLS-bypassing reads/writes). Does NOT require external-service keys, so
 * a missing VOYAGE_API_KEY won't break code paths that only need to talk to
 * Supabase.
 */
export function getAdminEnv() {
  if (!cachedAdminEnv) {
    cachedAdminEnv = AdminEnvSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }
  return cachedAdminEnv;
}

/**
 * Validates the full server env (auth + admin + external services). Use this
 * only in code paths that actually call external APIs (Voyage embed, etc.).
 */
export function getServerEnv() {
  if (!cachedServerEnv) {
    cachedServerEnv = ServerEnvSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      LLAMAPARSE_API_KEY: process.env.LLAMAPARSE_API_KEY,
    });
  }
  return cachedServerEnv;
}

export function getBrowserEnv() {
  if (!cachedBrowserEnv) {
    cachedBrowserEnv = BrowserEnvSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return cachedBrowserEnv;
}

// Test-only: clear all cached envs so tests can rotate process.env values.
export function resetEnvCacheForTesting() {
  cachedAuthEnv = undefined;
  cachedAdminEnv = undefined;
  cachedServerEnv = undefined;
  cachedBrowserEnv = undefined;
}
