-- 0011_external_authoritative_tier.sql
-- Phase 2.6 (part 1 of 2): adds `external_authoritative` to source_authority
-- enum. Must be its own migration because Postgres forbids using a freshly-
-- added enum value in the same transaction. The function update + weight
-- seed live in 0012.
--
-- Tier semantics: respected third-party content (industry analyst reports,
-- formal standards bodies, well-known whitepapers) that isn't vendor-published
-- and isn't internal.
-- Weight 0.7 — between vendor_reference (0.85) and internal_canonical (0.75).
-- The line vs internal_canonical: that tier requires explicit team blessing;
-- this tier rides on the source's reputational trust without team review.

ALTER TYPE public.source_authority ADD VALUE IF NOT EXISTS 'external_authoritative' BEFORE 'internal_canonical';
