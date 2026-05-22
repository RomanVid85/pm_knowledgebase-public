-- 0005_auth_user_trigger.sql
-- When Supabase Auth creates a new auth.users row, mirror it into public.users.
-- Resolves the FK gap intentionally left in 0001_core.sql (see CLAUDE.md / data_model.md).

-- =============================================================================
-- Trigger function on auth.users → public.users
-- =============================================================================
-- SECURITY DEFINER so the function runs as its owner (postgres) and can INSERT
-- into public.users despite RLS. SET search_path locks the function's lookup
-- path against search-path manipulation.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    -- Prefer explicit display_name from auth metadata, fall back to name, then email local-part.
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    'viewer',
    'active'
  )
  -- Safety net: if a public.users row already exists for this id, don't fail signup.
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Notes for future work (intentionally not in this migration):
--   * Email updates on auth.users do NOT propagate to public.users — punted to DEFERRED.md.
--   * Account deletion: V1 never hard-deletes; an admin sets users.status when needed.
