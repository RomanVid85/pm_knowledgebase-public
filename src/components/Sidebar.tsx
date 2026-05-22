// Persistent left nav for authenticated app pages.
//
// Server Component — reads user, role, and the per-user "verifiable rules"
// count. Passes everything to <SidebarClient/> for active-link tracking
// (which needs usePathname). Returns null when the user is unauthenticated
// so /login stays clean.
//
// The verifiable-rules count reuses the same eligibility logic as
// /verification: rule is in `pending_verification` AND user is not the
// extractor, AI invoker, or topic owner. Counted on every page render —
// one DB query, fine at V1 scale.

import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { SidebarClient } from "./SidebarClient";

export async function Sidebar() {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return null;

  const admin = adminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role, display_name, email")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  const displayName = profile?.display_name ?? profile?.email ?? user.email ?? "user";

  // Count rules the user CAN verify (same filter as /verification page).
  // Pulls the eligible rows then counts in JS — small data, simpler than
  // expressing the OR/NULL logic through PostgREST filters.
  let verifiableCount = 0;
  if (["admin", "sme", "pm"].includes(role)) {
    const { data: pending } = await admin
      .from("rules")
      .select("extracted_by, extracted_by_ai_job_invoker, topic:topic_id (owner_user_id)")
      .eq("status", "pending_verification");
    verifiableCount = (pending ?? []).filter((r) => {
      if (r.extracted_by === user.id) return false;
      if (r.extracted_by_ai_job_invoker === user.id) return false;
      if (r.topic && r.topic.owner_user_id === user.id) return false;
      return true;
    }).length;
  }

  // Count topic page drafts the user can publish — those on topics they own.
  // Only owners can publish (per Phase 5 owner-only review workflow).
  let publishableDraftCount = 0;
  const { data: draftsForOwnerCheck } = await admin
    .from("topic_pages")
    .select("topic:topic_id (owner_user_id)")
    .eq("status", "draft");
  publishableDraftCount = (draftsForOwnerCheck ?? []).filter(
    (d) => d.topic && d.topic.owner_user_id === user.id,
  ).length;

  return (
    <SidebarClient
      displayName={displayName}
      role={role}
      verifiableCount={verifiableCount}
      publishableDraftCount={publishableDraftCount}
    />
  );
}
