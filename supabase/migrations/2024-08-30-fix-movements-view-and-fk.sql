-- Align movements_view columns with API expectations and ensure user_profiles has FK to users
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

-- Ensure FK and uniqueness on user_profiles.user_id to support relationship discovery
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_user_id_fkey'
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.user_profiles
      add constraint user_profiles_user_id_fkey
      foreign key (user_id) references public.users(id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists user_profiles_user_id_ux
  on public.user_profiles(user_id);

-- Refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
