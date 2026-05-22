// Backfills topics.description_embedding for any row where it is NULL.
//
// Idempotent: only touches rows that haven't been embedded yet. Safe to re-run
// after partial failure, after adding new topics, or as a one-shot after
// applying migration 0009.
//
// Usage (local):
//   npx tsx --env-file=.env.local scripts/backfill_topic_embeddings.ts
//
// Usage (Cloud):
//   pass NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + VOYAGE_API_KEY
//   via a Cloud-targeted env file or inline env vars.

import { adminClient } from "@/lib/supabase/admin";
import { embedDocuments } from "@/lib/voyage/client";

async function main(): Promise<void> {
  const supabase = adminClient();

  const { data: pending, error: selectError } = await supabase
    .from("topics")
    .select("id, slug, name, description")
    .is("description_embedding", null)
    .order("slug");

  if (selectError) {
    throw new Error(`failed to fetch topics: ${selectError.message}`);
  }
  if (!pending || pending.length === 0) {
    console.log("backfill: no topics need embedding; exiting.");
    return;
  }

  console.log(`backfill: embedding ${pending.length} topic description(s)...`);
  const descriptions = pending.map((t) => t.description ?? t.name);
  const embeddings = await embedDocuments(descriptions);

  if (embeddings.length !== pending.length) {
    throw new Error(
      `Voyage returned ${embeddings.length} embeddings for ${pending.length} topics`,
    );
  }

  let updated = 0;
  for (let i = 0; i < pending.length; i++) {
    const topic = pending[i]!;
    const embedding = embeddings[i]!;
    const { error: updateError } = await supabase
      .from("topics")
      // pgvector accepts the array form in the JS client when the column
      // type is vector(N); the supabase-js types narrow it to string, so we
      // cast through unknown rather than wrap-as-string at runtime.
      .update({ description_embedding: embedding as unknown as string })
      .eq("id", topic.id);

    if (updateError) {
      throw new Error(`failed to update topic ${topic.slug}: ${updateError.message}`);
    }
    updated++;
    console.log(`  ✓ ${topic.slug} (${topic.name})`);
  }

  console.log(`backfill: done — updated ${updated}/${pending.length} topic rows.`);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
