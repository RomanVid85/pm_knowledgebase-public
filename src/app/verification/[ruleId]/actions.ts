"use server";

// Verification actions — accept or reject a pending rule.
//
// App-layer enforcement of the two-person rule is defense in depth; the
// DB CHECK constraint + `enforce_rules_verifier_not_topic_owner` trigger
// are the primary gate (see agent_docs/verification_workflow.md).

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";

const VERIFIER_ROLES = ["admin", "sme", "pm"] as const;

function errorRedirect(ruleId: string, message: string): never {
  redirect(`/verification/${ruleId}?error=${encodeURIComponent(message)}`);
}

async function loadVerifier(ruleId: string): Promise<{ id: string; role: string }> {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const admin = adminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? "viewer";
  if (!(VERIFIER_ROLES as readonly string[]).includes(role)) {
    errorRedirect(ruleId, `role '${role}' cannot verify rules`);
  }
  return { id: user.id, role };
}

async function loadRule(ruleId: string): Promise<{
  id: string;
  status: string;
  extracted_by: string | null;
  extracted_by_ai_job_invoker: string | null;
  topic_owner_user_id: string | null;
}> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("rules")
    .select(`id, status, extracted_by, extracted_by_ai_job_invoker, topic:topic_id (owner_user_id)`)
    .eq("id", ruleId)
    .single();
  if (error || !data) {
    errorRedirect(ruleId, `rule not found: ${error?.message ?? ""}`);
  }
  return {
    id: data.id,
    status: data.status,
    extracted_by: data.extracted_by,
    extracted_by_ai_job_invoker: data.extracted_by_ai_job_invoker,
    topic_owner_user_id: data.topic?.owner_user_id ?? null,
  };
}

function assertCanVerify(
  ruleId: string,
  userId: string,
  rule: {
    status: string;
    extracted_by: string | null;
    extracted_by_ai_job_invoker: string | null;
    topic_owner_user_id: string | null;
  },
): void {
  if (rule.status !== "pending_verification") {
    errorRedirect(ruleId, `rule is in status '${rule.status}', not pending_verification`);
  }
  if (rule.extracted_by === userId) {
    errorRedirect(ruleId, "you extracted this rule — a different verifier is required");
  }
  if (rule.extracted_by_ai_job_invoker === userId) {
    errorRedirect(
      ruleId,
      "you triggered the AI extraction that produced this rule — a different verifier is required",
    );
  }
  if (rule.topic_owner_user_id === userId) {
    errorRedirect(
      ruleId,
      "you are the topic owner for this rule's topic — a different verifier is required",
    );
  }
}

export async function acceptRule(formData: FormData): Promise<never> {
  const ruleId = String(formData.get("rule_id") ?? "");
  if (!ruleId) redirect("/verification?error=missing-rule-id");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const verifier = await loadVerifier(ruleId);
  const rule = await loadRule(ruleId);
  assertCanVerify(ruleId, verifier.id, rule);

  const admin = adminClient();
  const { error } = await admin
    .from("rules")
    .update({
      status: "active",
      human_verified: true,
      verified_by: verifier.id,
      verified_at: new Date().toISOString(),
      verification_notes: notes,
    })
    .eq("id", ruleId);
  if (error) {
    errorRedirect(ruleId, `accept failed: ${error.message}`);
  }

  redirect(`/verification?accepted=${ruleId}`);
}

export async function rejectRule(formData: FormData): Promise<never> {
  const ruleId = String(formData.get("rule_id") ?? "");
  if (!ruleId) redirect("/verification?error=missing-rule-id");
  const notes = String(formData.get("notes") ?? "").trim();
  if (notes.length === 0) {
    errorRedirect(ruleId, "rejection requires notes explaining why");
  }

  const verifier = await loadVerifier(ruleId);
  const rule = await loadRule(ruleId);
  assertCanVerify(ruleId, verifier.id, rule);

  const admin = adminClient();
  const { error } = await admin
    .from("rules")
    .update({
      status: "disputed",
      verified_by: verifier.id,
      verified_at: new Date().toISOString(),
      verification_notes: notes,
    })
    .eq("id", ruleId);
  if (error) {
    errorRedirect(ruleId, `reject failed: ${error.message}`);
  }

  redirect(`/verification?rejected=${ruleId}`);
}
