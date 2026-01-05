-- Ensure we're working in public schema
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
set search_path = public;

-- =========================================
-- RESET (DANGEROUS): uncomment to reset DB
-- =========================================
-- drop table if exists public.movements cascade;
-- drop table if exists public.inventory cascade;
-- drop table if exists public.items cascade;
-- drop table if exists public.users cascade;
-- drop table if exists public.idempotency_keys cascade;
-- drop table if exists public.locations cascade;
-- drop table if exists public.admin_logs cascade;
-- drop table if exists public.user_profiles cascade;
-- drop view if exists public.admin_users_view cascade;
-- drop type if exists public.user_role cascade;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role'
      and n.nspname = 'public'
  ) then
    create type public.user_role as enum ('admin','operator','viewer');
  end if;
end $$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role public.user_role not null default 'viewer',
  approved boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  username text not null unique,
  full_name text not null default '',
  department text not null default '',
  contact text not null default '',
  purpose text not null default '',
  approved boolean not null default false,
  role public.user_role not null default 'viewer',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.users(id)
);
create unique index if not exists user_profiles_user_id_ux on public.user_profiles(user_id);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  artist text not null,
  category text not null,
  album_version text not null,
  option text not null default ''
);
create unique index if not exists items_unique on public.items(artist, category, album_version, option);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  location text not null,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint inventory_unique unique (item_id, location)
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  location text not null,
  direction text not null check (direction in ('IN','OUT','ADJUST')),
  quantity integer not null,
  memo text default '',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  idempotency_key text unique,
  opening integer,
  closing integer
);

create unique index if not exists movements_idempotency_key_uniq
  on public.movements (idempotency_key) where idempotency_key is not null;

-- idempotency guard
create table if not exists public.idempotency_keys (
  key text primary key,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  name text primary key,
  description text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id),
  actor_email text,
  action text not null,
  detail jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_logs_created_at_idx on public.admin_logs(created_at desc);

-- materialized views
create or replace view public.admin_users_view as
select
  u.id,
  u.email,
  coalesce(p.full_name, u.email, '') as full_name,
  coalesce(p.department, '') as department,
  coalesce(p.contact, '') as contact,
  coalesce(p.purpose, '') as purpose,
  u.role,
  coalesce(u.approved, false) as approved,
  u.active,
  u.created_at
from public.users u
left join public.user_profiles p on p.user_id = u.id;

create or replace view public.inventory_view as
select
  inv.id as inventory_id,
  inv.item_id,
  i.artist,
  i.category,
  i.album_version,
  i.option,
  inv.location,
  inv.quantity
from public.inventory inv
join public.items i on inv.item_id = i.id;

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

-- transactional movement function with idempotency and negative stock allowance
create or replace function public.apply_movement(
  p_artist text,
  p_category text,
  p_album_version text,
  p_option text default '',
  p_location text,
  p_quantity int,
  p_direction text,
  p_memo text default '',
  p_created_by uuid,
  p_idempotency_key text
) returns json as $$
declare
  v_item_id uuid;
  v_movement_id uuid;
  v_inventory_qty int;
  v_direction text := upper(coalesce(p_direction, ''));
  v_location text := btrim(coalesce(p_location, ''));
  v_qty int := p_quantity;
  v_memo text := coalesce(p_memo, '');
  v_idem text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_option text := coalesce(p_option, '');
  v_delta int;
begin
  if v_direction not in ('IN','OUT') then
    raise exception 'invalid direction';
  end if;

  if v_qty is null or v_qty <= 0 then
    raise exception 'quantity must be positive';
  end if;

  if v_location is null or v_location = '' then
    raise exception 'location required';
  end if;

  v_delta := case when v_direction = 'IN' then v_qty else -v_qty end;

  insert into public.items as i (artist, category, album_version, option)
  values (p_artist, p_category, p_album_version, v_option)
  on conflict (artist, category, album_version, option)
  do update set artist = excluded.artist
  returning i.id into v_item_id;

  insert into public.movements(item_id, location, direction, quantity, memo, created_by, idempotency_key)
  values (v_item_id, v_location, v_direction, v_qty, v_memo, p_created_by, v_idem)
  on conflict (idempotency_key) do nothing
  returning id into v_movement_id;

  if v_movement_id is null then
    select id, item_id
      into v_movement_id, v_item_id
      from public.movements
     where idempotency_key = v_idem;

    select quantity
      into v_inventory_qty
      from public.inventory
     where item_id = v_item_id
       and location = v_location;

    return json_build_object(
      'ok', true,
      'duplicated', true,
      'movement_id', v_movement_id,
      'item_id', v_item_id,
      'inventory_quantity', coalesce(v_inventory_qty, 0),
      'message', 'duplicate request ignored'
    );
  end if;

  update public.inventory
     set quantity = quantity + v_delta,
         updated_at = now()
   where item_id = v_item_id
     and location = v_location
  returning quantity into v_inventory_qty;

  if v_inventory_qty is null then
    insert into public.inventory(item_id, location, quantity)
    values (v_item_id, v_location, v_delta)
    returning quantity into v_inventory_qty;
  end if;

  if v_inventory_qty is null then
    raise exception 'inventory update failed';
  end if;

  return json_build_object(
    'ok', true,
    'duplicated', false,
    'movement_id', v_movement_id,
    'item_id', v_item_id,
    'inventory_quantity', v_inventory_qty,
    'message', 'ok'
  );
end;
$$ language plpgsql security definer;

-- movement recording with idempotency that allows negative stock
create or replace function public.record_movement_v2(
  album_version text,
  artist text,
  category text,
  created_by uuid default null,
  direction text,
  idempotency_key text default null,
  location text,
  memo text default '',
  option text default '',
  quantity int
) returns json as $$
#variable_conflict use_variable
declare
  v_item_id uuid;
  v_existing int;
  v_new int;
  v_movement_id uuid;
  v_rowcount int;
  v_idem text := nullif(btrim(idempotency_key), '');
  v_location text := btrim(location);
  v_direction text := upper(direction);
  v_artist text := btrim(artist);
  v_album text := btrim(album_version);
  v_option text := coalesce(option, '');
  v_memo text := nullif(btrim(memo), '');
  v_qty int := quantity;
  v_existing_opening integer;
  v_existing_closing integer;
begin
  if v_direction not in ('IN','OUT','ADJUST') then
    raise exception 'invalid direction';
  end if;

  if v_idem is not null then
    select id, item_id, opening, closing
      into v_movement_id, v_item_id, v_existing_opening, v_existing_closing
      from public.movements
     where idempotency_key = v_idem;

    if found then
      return json_build_object(
        'ok', true,
        'idempotent', true,
        'movement_inserted', false,
        'inventory_updated', false,
        'movement_id', v_movement_id,
        'item_id', v_item_id,
        'opening', v_existing_opening,
        'closing', v_existing_closing,
        'message', 'idempotent hit'
      );
    end if;
  end if;

  insert into public.items as i (artist, category, album_version, option)
  values (v_artist, category, v_album, v_option)
  on conflict (artist, category, album_version, option)
  do update set artist = excluded.artist
  returning i.id into v_item_id;

  insert into public.inventory(item_id, location, quantity)
  values (v_item_id, v_location, 0)
  on conflict (item_id, location) do nothing;

  select quantity
    into v_existing
    from public.inventory
   where item_id = v_item_id
     and location = v_location
   for update;

  if v_direction = 'IN' then
    v_new := v_existing + v_qty;
  elsif v_direction = 'OUT' then
    v_new := v_existing - v_qty;
  else
    v_new := v_qty;
  end if;

  update public.inventory
     set quantity = v_new,
         updated_at = now()
   where item_id = v_item_id
     and location = v_location;

  get diagnostics v_rowcount = row_count;
  if v_rowcount <= 0 then
    raise exception 'inventory update failed';
  end if;

  insert into public.movements(
    item_id,
    location,
    direction,
    quantity,
    memo,
    created_by,
    idempotency_key,
    opening,
    closing,
    created_at
  ) values (
    v_item_id,
    v_location,
    v_direction,
    v_qty,
    v_memo,
    created_by,
    v_idem,
    v_existing,
    v_new,
    now()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_movement_id;

  if v_movement_id is null then
    raise exception 'idempotency conflict';
  end if;

  return json_build_object(
    'ok', true,
    'idempotent', false,
    'movement_inserted', true,
    'inventory_updated', true,
    'opening', v_existing,
    'closing', v_new,
    'item_id', v_item_id,
    'movement_id', v_movement_id,
    'message', 'ok'
  );
exception
  when others then
    raise;
end;
$$ language plpgsql security definer;

grant execute on function public.record_movement_v2(
  text, text, text, uuid, text, text, text, text, text, int
) to authenticated, service_role;

create or replace function public.record_movement(
  artist text,
  category text,
  album_version text,
  option text,
  location text,
  quantity integer,
  direction text,
  memo text,
  created_by uuid,
  idempotency_key text
) returns json
language sql
security definer
set search_path = public
as $$
  select public.record_movement_v2(
    album_version,
    artist,
    category,
    created_by,
    direction,
    idempotency_key,
    location,
    memo,
    option,
    quantity
  );
$$;

grant execute on function public.record_movement(
  text, text, text, text, text, integer, text, text, uuid, text
) to authenticated, service_role;

-- diagnostics helper to confirm connected database and counts
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

-- smoke test
-- select * from public.inventory_view limit 1;
-- select public.record_movement('A','album','v1','', 'loc1', 1, 'IN', 'test', null, 'k1');

-- admin update user with transactional consistency across users and user_profiles
create or replace function public.admin_update_user(
  p_id uuid,
  p_approved boolean default null,
  p_role public.user_role default null,
  p_actor_id uuid default null
) returns admin_users_view as $$
declare
  v_row admin_users_view%rowtype;
  v_count int;
begin
  if p_id is null then
    raise exception 'id is required';
  end if;

  update public.users
     set approved = coalesce(p_approved, approved),
         role = coalesce(p_role, role)
   where id = p_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'user not found';
  end if;

  update public.user_profiles
     set approved = coalesce(p_approved, approved),
         approved_at = case
           when p_approved is true then now()
           when p_approved is false then null
           else approved_at
         end,
         approved_by = case
           when p_approved is true then p_actor_id
           when p_approved is false then null
           else approved_by
         end
   where user_id = p_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'user profile not found';
  end if;

  select * into v_row from public.admin_users_view where id = p_id;
  if not found then
    raise exception 'user not found in admin_users_view';
  end if;

  return v_row;
exception
  when others then
    raise;
end;
$$ language plpgsql security definer;

-- RLS safeguards to allow authenticated users to read their own records when client-side checks are used
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
