// Zod schemas for the review-page server action's payload. Kept in a
// non-"use server" module because Next.js requires "use server" files to
// export only async functions — Zod objects are values, so they'd break
// the production build if re-exported from actions.ts.

import { z } from "zod";

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const ExistingAcceptSchema = z.object({
  topic_id: z.string().uuid(),
  confidence: z.number().min(0).max(1),
});

export const NewTopicSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  description: z.string().min(1),
  vendor: z.string().nullable(),
  confidence: z.number().min(0).max(1).optional(),
});

export const ManualTopicSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  name: z.string().min(1),
  description: z.string().min(1),
  vendor: z.string().nullable(),
});

export const SupersedesSchema = z.object({
  prior_artifact_id: z.string().uuid(),
});

export const ReviewPayloadSchema = z
  .object({
    artifact_id: z.string().uuid(),
    /** Vendor name committed by the PM (or inferred + confirmed). null = non-vendor opt-out. */
    vendor: z.string().min(1).nullable(),
    /**
     * Optional vendor-version string committed by the PM (or inferred and
     * confirmed). Free-form so the PM isn't boxed into one syntax — `v3`,
     * `2.5.1`, `2024-Q4`, etc. all valid. Used by supersession detection
     * to distinguish a re-upload of the same content from a new version.
     */
    vendor_version: z.string().min(1).nullable(),
    /**
     * 3-state vendor classification per migration 0013. Must be non-null at
     * commit time. The refinement below enforces the (vendor, is_vendor_specific)
     * consistency the DB CHECK constraint also enforces.
     */
    is_vendor_specific: z.boolean(),
    existing: z.array(ExistingAcceptSchema),
    proposed_new: z.array(NewTopicSchema),
    manual: z.array(ManualTopicSchema),
    supersedes: SupersedesSchema.nullable(),
  })
  .refine(
    (p) =>
      (p.is_vendor_specific === true && p.vendor !== null) ||
      (p.is_vendor_specific === false && p.vendor === null),
    {
      message:
        "vendor and is_vendor_specific must agree: either vendor set with is_vendor_specific=true, OR vendor=null with is_vendor_specific=false",
      path: ["vendor"],
    },
  );

export type ReviewPayload = z.infer<typeof ReviewPayloadSchema>;
