-- Add diagnostics helper, refresh movements_view with department, and open select access
create or replace view public.movements_view as
select
  m.created_at,
  m.direction,
  coalesce(i.artist, '') as artist,
  coalesce(i.category, '') as category,
  coalesce(i.album_version, '') as album_version,
  coalesce(i.option, '') as option,
  m.location,
  m.quantity,
  m.memo,
  m.item_id,
  m.created_by,
  coalesce(up.full_name, u.email, m.created_by::text, '') as created_by_name,
  coalesce(up.department, '') as created_by_department
from public.movements m
left join public.items i on i.id = m.item_id
left join public.users u on u.id = m.created_by
left join public.user_profiles up on up.user_id = u.id
order by m.created_at desc;

-- Diagnostics snapshot for verifying the connected database and counts
create or replace function public.diag_db_snapshot()
returns json as $$
declare
  v_db text;
  v_now timestamptz := now();
  v_movements_cnt bigint;
  v_movements_max timestamptz;
  v_mv_cnt bigint;
  v_mv_max timestamptz;
  v_users_cnt bigint;
  v_profiles_cnt bigint;
begin
  select current_database() into v_db;
  select count(*), max(created_at) into v_movements_cnt, v_movements_max from public.movements;
  select count(*), max(created_at) into v_mv_cnt, v_mv_max from public.movements_view;
  select count(*) into v_users_cnt from public.users;
  select count(*) into v_profiles_cnt from public.user_profiles;

  return json_build_object(
    'db', v_db,
    'now_utc', v_now,
    'movements_cnt', v_movements_cnt,
    'movements_max', v_movements_max,
    'movements_view_cnt', v_mv_cnt,
    'movements_view_max', v_mv_max,
    'users_cnt', v_users_cnt,
    'profiles_cnt', v_profiles_cnt
  );
end;
$$ language plpgsql security definer;

grant execute on function public.diag_db_snapshot() to authenticated, service_role;

-- RLS safeguards so authenticated users can read their own rows when client-side checks are used
alter table if exists public.users enable row level security;
alter table if exists public.user_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users_select_own'
  ) then
    create policy users_select_own on public.users for select to authenticated using (id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'profiles_select_own'
  ) then
    create policy profiles_select_own on public.user_profiles for select to authenticated using (user_id = auth.uid());
  end if;
end;
$$;

-- Ensure PostgREST sees the changes immediately
select pg_notify('pgrst', 'reload schema');
