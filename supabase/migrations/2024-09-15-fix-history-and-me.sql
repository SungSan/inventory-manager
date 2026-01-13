-- Reinforce movements_view contract and users<->profiles relationship for history/me endpoints
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
join public.items i on i.id = m.item_id
left join public.users u on u.id = m.created_by
left join public.user_profiles p on p.user_id = m.created_by;

grant select on public.movements_view to authenticated, anon;

-- Ensure user_profiles.user_id is uuid and linked to public.users for PostgREST relationships
DO $$
declare
  v_udt text;
begin
  select udt_name into v_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'user_profiles'
    and column_name = 'user_id';

  if v_udt is not null and v_udt <> 'uuid' then
    execute 'alter table public.user_profiles alter column user_id type uuid using user_id::uuid';
  end if;
end$$;

DO $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'user_profiles'
      and tc.constraint_type = 'FOREIGN KEY'
      and kcu.column_name = 'user_id'
      and ccu.table_name = 'users'
      and ccu.column_name = 'id'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_user_id_fkey
      foreign key (user_id) references public.users(id)
      on delete cascade;
  end if;
end$$;

create unique index if not exists user_profiles_user_id_ux
  on public.user_profiles(user_id);

-- Reload PostgREST schema cache so updated view and FK are visible
select pg_notify('pgrst','reload schema');
select pg_notify('pgrst','reload schema');
