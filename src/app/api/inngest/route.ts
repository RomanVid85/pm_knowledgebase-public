// Inngest webhook endpoint — Inngest's servers (or the local dev server)
// POST function manifests and step invocations here.

import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { ingestArtifact } from "@/inngest/functions/ingest-artifact";
import { extractRulesFunction } from "@/inngest/functions/extract-rules";
import { compileTopicPageFunction } from "@/inngest/functions/compile-topic-page";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ingestArtifact, extractRulesFunction, compileTopicPageFunction],
});
