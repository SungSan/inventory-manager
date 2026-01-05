-- Ensure user_profiles has a FK to public.users so PostgREST can relate users and profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_profiles_user_id_public_users_fkey'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_public_users_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END$$;

-- Keep 1:1 relationship enforced
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_user_id_ux
  ON public.user_profiles(user_id);

-- movements_view with id column and creator metadata
CREATE OR REPLACE VIEW public.movements_view AS
SELECT
  m.id,
  m.created_at,
  m.direction,
  i.artist,
  i.category,
  i.album_version,
  i.option,
  m.location,
  m.quantity,
  m.memo,
  m.item_id,
  m.created_by,
  COALESCE(p.full_name, u.email, m.created_by::text, '') AS created_by_name,
  COALESCE(p.department, '') AS created_by_department
FROM public.movements m
JOIN public.items i ON i.id = m.item_id
LEFT JOIN public.users u ON u.id = m.created_by
LEFT JOIN public.user_profiles p ON p.user_id = m.created_by;

GRANT SELECT ON public.movements_view TO authenticated, anon;

-- Refresh PostgREST schema cache so the new FK and view shape are visible immediately
SELECT pg_notify('pgrst', 'reload schema');
