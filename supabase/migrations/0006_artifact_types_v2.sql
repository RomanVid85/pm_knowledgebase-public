-- 0006_artifact_types_v2.sql
-- Extends the artifact_type enum to cover prose corpora alongside structured specs.
--   * 'api_documentation' — prose API documentation captured from a vendor
--     portal (e.g. an HTML or DOCX export of an API guide). Distinct from
--     'openapi_spec', which is the machine-readable spec itself.
--   * 'training_guide' — vendor learning-center exports
--     (e.g. a knowledge-base markdown bundle).
-- Idempotent (IF NOT EXISTS). Postgres 12+ supports adding enum values inside
-- a transaction; the new values become usable after the migration commits.

ALTER TYPE artifact_type ADD VALUE IF NOT EXISTS 'api_documentation';
ALTER TYPE artifact_type ADD VALUE IF NOT EXISTS 'training_guide';
