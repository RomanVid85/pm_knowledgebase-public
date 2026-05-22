-- 0007_storage_buckets.sql
-- Phase 2.A R3: artifacts Storage bucket + RLS.
-- Bucket is private. Reads gated to authenticated users; writes to pm/sme/admin.
-- No DELETE policy — V1 never hard-deletes (per CLAUDE.md soft-delete principle).

INSERT INTO storage.buckets (id, name, public)
VALUES ('artifacts', 'artifacts', false)
ON CONFLICT (id) DO NOTHING;

-- RLS is enabled on storage.objects by default in Supabase.

DROP POLICY IF EXISTS "Authenticated read artifacts" ON storage.objects;
CREATE POLICY "Authenticated read artifacts"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'artifacts');

DROP POLICY IF EXISTS "PMs and SMEs and admins write artifacts" ON storage.objects;
CREATE POLICY "PMs and SMEs and admins write artifacts"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'artifacts'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'pm', 'sme')
    )
  );

DROP POLICY IF EXISTS "PMs and SMEs and admins update artifacts" ON storage.objects;
CREATE POLICY "PMs and SMEs and admins update artifacts"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'artifacts'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'pm', 'sme')
    )
  )
  WITH CHECK (
    bucket_id = 'artifacts'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'pm', 'sme')
    )
  );

-- No DELETE policy on purpose. To "remove" an artifact, set
-- public.artifacts.status='archived' and leave the Storage object in place.
