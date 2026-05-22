-- 0015_field_notes_and_attachments.sql
-- Field-note artifact type + attachments column.
--
-- Why field notes exist (separate from ordinary uploads): some knowledge
-- comes in informal channels — a vendor engineer's email, a Slack
-- screenshot, an internal phone-call summary. The doc IS the proof, but
-- the content of value is the PM's written interpretation. Uploading the
-- raw screenshot loses that — OCR captures fragments of UI strings, not
-- the PM's domain knowledge. A field note inverts the model: the PM
-- writes the prose, attaches the screenshot as evidence.
--
-- Two schema additions:
--   1. New `field_note` enum value on artifact_type.
--   2. `attachments` jsonb array on artifacts — array of
--      {storage_path, filename, mime_type, size_bytes, uploaded_at}
--      describing the evidence files. Optional; defaults to '[]'.

-- =============================================================================
-- 1. Extend artifact_type enum
-- =============================================================================
ALTER TYPE public.artifact_type ADD VALUE IF NOT EXISTS 'field_note';

-- =============================================================================
-- 2. attachments column on artifacts
-- =============================================================================
ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.artifacts.attachments IS
  'Array of attachment metadata for field-note artifacts: '
  '[{storage_path, filename, mime_type, size_bytes, uploaded_at}, ...]. '
  'Attachments are evidence/provenance (screenshots, emails, recordings) — '
  'NOT parsed for content. The artifact''s extracted_content carries the '
  'actual searchable knowledge written by the PM. Defaults to [] for '
  'ordinary uploads where there are no extra attachments.';
