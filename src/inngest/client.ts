// Inngest client + typed event registry.
//
// Every event the app sends or consumes should be declared here so the
// `inngest.send()` and `step.run()` call sites get full type safety.

import { Inngest, EventSchemas } from "inngest";

type Events = {
  "ingest/artifact-uploaded": {
    data: {
      artifactId: string;
      invokerUserId: string;
    };
  };
  "rule-extraction/requested": {
    data: {
      artifactId: string;
      invokerUserId: string;
    };
  };
  "topic-page/compile-requested": {
    data: {
      topicId: string;
      invokerUserId: string;
    };
  };
};

export const inngest = new Inngest({
  id: "pm-knowledge-base",
  schemas: new EventSchemas().fromRecord<Events>(),
});
