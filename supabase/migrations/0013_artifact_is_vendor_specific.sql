-- 0013_artifact_is_vendor_specific.sql
-- Disambiguates the meaning of artifacts.vendor IS NULL.
--
-- Background: making vendor optional on the upload form is convenient, but
-- it lets uploaders leave vendor blank by accident — which silently breaks
-- supersession detection (it requires same-vendor match).
--
-- This column makes the classification explicit:
--   - NULL  → undecided. Initial state until the PM reviews.
--   - TRUE  → vendor-specific artifact. artifacts.vendor must also be set.
--   - FALSE → intentionally non-vendor (industry research, internal
--             strategy, customer feedback). artifacts.vendor stays NULL
--             by design.
--
-- The review server action validates that is_vendor_specific is non-NULL
-- before flipping status to 'active' — forcing the PM to commit one way
-- or the other.

ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS is_vendor_specific boolean;

COMMENT ON COLUMN public.artifacts.is_vendor_specific IS
  'Three-state vendor classification, committed by the PM at review time. '
  'NULL = undecided (initial state). TRUE = vendor-specific; artifacts.vendor '
  'must be set. FALSE = intentionally non-vendor (industry research, internal '
  'strategy, customer feedback); artifacts.vendor stays NULL by design. '
  'The review server action validates this is non-NULL before status=''active''.';

-- Optional integrity hint: a CHECK constraint that prevents accidentally
-- saving inconsistent state (is_vendor_specific=true with vendor=NULL, or
-- is_vendor_specific=false with vendor SET). Soft enforcement — the app
-- layer is the primary gate, this is defense in depth.
ALTER TABLE public.artifacts
  ADD CONSTRAINT artifacts_vendor_consistency CHECK (
    is_vendor_specific IS NULL  -- undecided is always fine (status='draft')
    OR (is_vendor_specific = TRUE  AND vendor IS NOT NULL)
    OR (is_vendor_specific = FALSE AND vendor IS NULL)
  );
