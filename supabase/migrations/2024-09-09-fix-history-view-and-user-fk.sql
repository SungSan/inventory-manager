-- Ensure movements_view exposes id and creator metadata for history API
create or replace view public.movements_view as
select
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
  coalesce(p.full_name, u.email, m.created_by::text, '') as created_by_name,
  coalesce(p.department, '') as created_by_department
from public.movements m
join public.items i
  on i.id = m.item_id
left join public.users u
  on u.id = m.created_by
left join public.user_profiles p
  on p.user_id = m.created_by;

grant select on public.movements_view to authenticated, anon;

-- Ensure user_profiles has FK to users for relationship discovery used by /me
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_user_id_fkey'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

create unique index if not exists user_profiles_user_id_ux
  on public.user_profiles(user_id);

-- Reload PostgREST schema cache so endpoints pick up the view/FK changes
select pg_notify('pgrst', 'reload schema');
