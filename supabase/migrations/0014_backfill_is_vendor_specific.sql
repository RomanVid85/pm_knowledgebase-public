-- 0014_backfill_is_vendor_specific.sql
-- Phase 2.7 polish (task 2.7.7): backfill is_vendor_specific for active
-- artifacts that pre-date the column. Migration 0013 added the column
-- nullable so the rollout was non-breaking; this migration closes the
-- legacy-NULL gap for the existing corpus.
--
-- Strategy:
--   - active rows with vendor SET → is_vendor_specific = TRUE
--     (these were uploaded via the pre-Phase-2.7 flow where the vendor
--      field was either defaulted or explicitly typed; their classification
--      is implicitly "vendor-specific.")
--   - We intentionally do NOT backfill rows with vendor IS NULL — those
--     are either (a) the archived test/duplicate artifacts we cleaned up
--     earlier (no need to classify; out of retrieval anyway), or (b) a
--     fresh upload mid-review (its is_vendor_specific should stay NULL
--     until the PM commits via the review action). The WHERE clause's
--     `is_vendor_specific IS NULL` makes this idempotent — re-running has
--     no effect.
--
-- Defense in depth: the artifacts_vendor_consistency CHECK constraint
-- ensures the (vendor, is_vendor_specific) pair is always coherent.

UPDATE public.artifacts
SET is_vendor_specific = TRUE
WHERE status = 'active'
  AND vendor IS NOT NULL
  AND is_vendor_specific IS NULL;
