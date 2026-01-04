-- Ensure movements_view exposes id and creator metadata expected by the web history API
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

-- Add a public.users foreign key on user_profiles.user_id so PostgREST can resolve the relationship
-- (keep existing auth.users relationship untouched)
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'user_profiles'
      and c.conname = 'user_profiles_user_id_public_users_fkey'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_user_id_public_users_fkey
      foreign key (user_id) references public.users(id)
      on delete cascade
      not valid;
  end if;
end $$;

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.user_profiles p
  left join public.users u on u.id = p.user_id
  where u.id is null;

  if v_missing = 0 then
    if exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'user_profiles'
        and c.conname = 'user_profiles_user_id_public_users_fkey'
        and c.convalidated = false
    ) then
      alter table public.user_profiles
        validate constraint user_profiles_user_id_public_users_fkey;
    end if;
  end if;
end $$;

-- Reload PostgREST schema cache so /me and /history pick up the changes
select pg_notify('pgrst', 'reload schema');
