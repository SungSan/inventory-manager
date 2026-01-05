-- Ensure movements_view exposes id and creator metadata expected by web history queries
create or replace view public.movements_view as
select
  m.id as id,
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
  coalesce(p.full_name, u.email, m.created_by::text, ''::text) as created_by_name,
  coalesce(p.department, ''::text) as created_by_department
from public.movements m
join public.items i on i.id = m.item_id
left join public.users u on u.id = m.created_by
left join public.user_profiles p on p.user_id = m.created_by;

grant select on public.movements_view to authenticated, anon;

-- Add missing FK from public.user_profiles to public.users so PostgREST can resolve relationships used by /api/auth/me
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_profiles'
      AND c.conname = 'user_profiles_user_id_public_users_fkey'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_public_users_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END$$;

-- Validate the FK only when no orphaned profile rows exist
DO $$
DECLARE
  v_missing integer;
  v_needs_validate boolean;
BEGIN
  SELECT count(*)
    INTO v_missing
    FROM public.user_profiles p
    LEFT JOIN public.users u ON u.id = p.user_id
   WHERE u.id IS NULL;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_profiles'
      AND c.conname = 'user_profiles_user_id_public_users_fkey'
      AND c.convalidated = false
  ) INTO v_needs_validate;

  IF v_missing = 0 AND v_needs_validate THEN
    ALTER TABLE public.user_profiles
      VALIDATE CONSTRAINT user_profiles_user_id_public_users_fkey;
  ELSIF v_missing > 0 THEN
    RAISE NOTICE 'user_profiles rows without matching public.users.id: %', v_missing;
  END IF;
END$$;

-- Refresh PostgREST schema cache so /me and history use the updated definitions
select pg_notify('pgrst', 'reload schema');
