// Manually trigger rule extraction for an existing artifact. Use when an
// artifact pre-dates the auto-fire-from-review path (anything ingested
// before Phase 4), or when re-extracting after fixing a prompt or schema
// issue.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/extract_rules.ts <artifact-id> [invoker-user-id]
//
// If invoker-user-id is omitted, defaults to the artifact's `uploaded_by`.
// The invoker matters: per verification_workflow.md, they cannot later
// verify the auto-extracted rules.

import { adminClient } from "@/lib/supabase/admin";
import { inngest } from "@/inngest/client";

async function main(): Promise<void> {
  const [artifactId, invokerArg] = process.argv.slice(2);
  if (!artifactId) {
    console.error("usage: tsx scripts/extract_rules.ts <artifact-id> [invoker-user-id]");
    process.exit(1);
  }

  const supabase = adminClient();
  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select("id, title, status, uploaded_by")
    .eq("id", artifactId)
    .single();
  if (error || !artifact) {
    console.error(`artifact ${artifactId} not found: ${error?.message ?? ""}`);
    process.exit(1);
  }
  if (artifact.status !== "active") {
    console.error(
      `artifact ${artifactId} is in status '${artifact.status}' — extraction requires 'active'`,
    );
    process.exit(1);
  }

  const invokerUserId = invokerArg ?? artifact.uploaded_by;
  if (!invokerUserId) {
    console.error(
      `no invoker user id — pass one as a second arg, or set artifacts.uploaded_by`,
    );
    process.exit(1);
  }

  console.log(`Triggering rule extraction for:`);
  console.log(`  artifact: ${artifact.title} (${artifact.id})`);
  console.log(`  invoker:  ${invokerUserId}`);

  const res = await inngest.send({
    name: "rule-extraction/requested",
    data: { artifactId, invokerUserId },
  });
  console.log(`Inngest event sent: ${JSON.stringify(res, null, 2)}`);
  console.log(`\nWatch the Inngest dashboard to follow the run.`);
}

main().catch((err) => {
  console.error("extract_rules failed:", err);
  process.exit(1);
});
