// Quick ad-hoc retrieval CLI. Embeds the query via Voyage, runs the
// search_chunks RPC, prints the top results with their score breakdown +
// the artifact's format (so cross-format retrieval is visible at a glance).
//
// Usage (local):
//   npx tsx --env-file=.env.local scripts/search.ts "your query here"
//
// Usage (Cloud):
//   NEXT_PUBLIC_SUPABASE_URL=<cloud> \
//     SUPABASE_SERVICE_ROLE_KEY=<cloud> \
//     npx tsx scripts/search.ts "your query here"

import { adminClient } from "@/lib/supabase/admin";
import { searchKnowledge } from "@/lib/retrieval/search";

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error("usage: tsx scripts/search.ts \"<query>\"");
    process.exit(1);
  }

  const supabase = adminClient();
  const results = await searchKnowledge(supabase, query, { limit: 8 });

  console.log(`\nquery: "${query}"`);
  console.log(`results: ${results.length}\n`);

  // Fetch each artifact's format + vendor for the readout — search returns
  // chunk + artifact_title but not format/vendor. One round-trip; cheap.
  const artifactIds = [...new Set(results.map((r) => r.artifactId))];
  const { data: artRows } = artifactIds.length
    ? await supabase
        .from("artifacts")
        .select("id, artifact_type, vendor")
        .in("id", artifactIds)
    : { data: [] };
  const artMeta = new Map((artRows ?? []).map((a) => [a.id, a]));

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const meta = artMeta.get(r.artifactId);
    const format = meta?.artifact_type ?? "?";
    const vendor = meta?.vendor ?? "(none)";
    const c = r.components;
    console.log(
      `  ${(i + 1).toString().padStart(2)}. score=${r.score.toFixed(3)}  ` +
        `sim=${c.similarity.toFixed(3)} auth=${c.authority.toFixed(2)} ` +
        `rec=${c.recency.toFixed(2)} conf=${c.confidence.toFixed(2)}`,
    );
    console.log(`      [${format} · ${vendor}] ${r.artifactTitle}`);
    if (r.section) console.log(`      § ${r.section}`);
    console.log(`      ${r.content.replace(/\s+/g, " ").slice(0, 140)}…`);
    console.log();
  }
}

main().catch((err) => {
  console.error("search failed:", err);
  process.exit(1);
});
