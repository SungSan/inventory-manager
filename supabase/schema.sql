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

  if exists (
    select 1 from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'user_role'
      and e.enumlabel = 'l_operator'
  ) is false then
    begin
      alter type public.user_role add value 'l_operator';
    exception when duplicate_object then
      -- ignore if added concurrently
      null;
    end;
  end if;

  if exists (
    select 1 from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'user_role'
      and e.enumlabel = 'manager'
  ) is false then
    begin
      alter type public.user_role add value 'manager';
    exception when duplicate_object then
      -- ignore if added concurrently
      null;
    end;
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

create table if not exists public.user_location_permissions (
  user_id uuid primary key references public.users(id) on delete cascade,
  primary_location text not null,
  sub_locations text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_user_location_permissions()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_touch_user_location_permissions') then
    create trigger trg_touch_user_location_permissions
    before update on public.user_location_permissions
    for each row
    execute function public.touch_user_location_permissions();
  end if;
end$$;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  artist text not null,
  category text not null,
  album_version text not null,
  option text not null default '',
  barcode text
);
create unique index if not exists items_unique on public.items(artist, category, album_version, option);
create unique index if not exists items_barcode_ux on public.items(barcode) where barcode is not null;

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
  direction text not null check (direction in ('IN','OUT','ADJUST','TRANSFER')),
  from_location text,
  to_location text,
  transfer_group_id uuid,
  quantity integer not null,
  memo text default '',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  idempotency_key text unique,
  opening integer,
  closing integer,
  barcode text
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
  i.barcode,
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
  i.barcode,
  m.location,
  m.from_location,
  m.to_location,
  m.quantity,
  m.memo,
  m.item_id,
  m.created_by,
  m.transfer_group_id,
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
  quantity int,
  barcode text default null
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

  insert into public.items as i (artist, category, album_version, option, barcode)
  values (v_artist, category, v_album, v_option, barcode)
  on conflict (artist, category, album_version, option)
  do update set artist = excluded.artist,
    barcode = coalesce(excluded.barcode, i.barcode)
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
  text, text, text, uuid, text, text, text, text, text, int, text
) to authenticated, service_role;

create or replace function public.record_movement(
  album_version text,
  artist text,
  category text,
  created_by uuid,
  direction text,
  idempotency_key text,
  location text,
  memo text,
  option text,
  quantity integer
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
    quantity,
    null
  );
$$;

grant execute on function public.record_movement(
  text, text, text, uuid, text, text, text, text, text, integer
) to authenticated, service_role;

create or replace function public.record_movement(
  album_version text,
  artist text,
  category text,
  created_by uuid,
  direction text,
  idempotency_key text,
  location text,
  memo text,
  option text,
  quantity integer,
  barcode text
) returns json as $$
#variable_conflict use_variable
declare
  v_result json;
  v_item_id uuid;
  v_item_count int;
  v_barcode text := nullif(btrim(barcode), '');
begin
  v_result := public.record_movement(
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

  if v_barcode is null then
    return v_result;
  end if;

  v_item_id := nullif(v_result->>'item_id', '')::uuid;
  if v_item_id is null then
    select count(*)
      into v_item_count
      from public.items
     where items.artist = artist
       and items.category = category
       and items.album_version = album_version
       and items.option = option;
    if v_item_count <> 1 then
      raise exception 'items match count mismatch: %', v_item_count;
    end if;
    select id into v_item_id
      from public.items
     where items.artist = artist
       and items.category = category
       and items.album_version = album_version
       and items.option = option
     limit 1;
  end if;

  update public.items
     set barcode = v_barcode
   where id = v_item_id;

  return v_result;
end;
$$ language plpgsql security definer;

grant execute on function public.record_movement(
  text, text, text, uuid, text, text, text, text, text, integer, text
) to authenticated, service_role;

create or replace function public.record_transfer(
  artist text,
  category text,
  album_version text,
  option text,
  from_location text,
  to_location text,
  quantity integer,
  memo text default '',
  created_by uuid default null,
  idempotency_key text default null,
  barcode text default null
) returns json as $$
#variable_conflict use_variable
declare
  v_item_id uuid;
  v_group uuid := gen_random_uuid();
  v_idem text := nullif(btrim(idempotency_key), '');
  v_qty int := quantity;
  v_from_qty int := 0;
  v_to_qty int := 0;
  v_from_new int := 0;
  v_to_new int := 0;
  v_out_id uuid;
  v_in_id uuid;
begin
  if v_idem is not null then
    select transfer_group_id
      into v_group
      from public.movements
     where idempotency_key = v_idem
       and direction = 'TRANSFER'
     limit 1;
    if found then
      return json_build_object('ok', true, 'idempotent', true, 'transfer_group_id', v_group);
    end if;
  end if;

  insert into public.items as i (artist, category, album_version, option, barcode)
  values (artist, category, album_version, option, barcode)
  on conflict (artist, category, album_version, option)
  do update set barcode = coalesce(excluded.barcode, i.barcode)
  returning i.id into v_item_id;

  insert into public.inventory(item_id, location, quantity)
  values (v_item_id, from_location, 0)
  on conflict (item_id, location) do nothing;

  insert into public.inventory(item_id, location, quantity)
  values (v_item_id, to_location, 0)
  on conflict (item_id, location) do nothing;

  select quantity into v_from_qty from public.inventory where item_id = v_item_id and location = from_location for update;
  select quantity into v_to_qty from public.inventory where item_id = v_item_id and location = to_location for update;

  v_from_new := v_from_qty - v_qty;
  v_to_new := v_to_qty + v_qty;

  update public.inventory set quantity = v_from_new, updated_at = now() where item_id = v_item_id and location = from_location;
  update public.inventory set quantity = v_to_new, updated_at = now() where item_id = v_item_id and location = to_location;

  insert into public.movements(
    item_id, location, direction, quantity, memo, created_by, idempotency_key, transfer_group_id, from_location, to_location, opening, closing, created_at
  ) values (
    v_item_id, from_location, 'TRANSFER', v_qty, memo, created_by, v_idem || '-out', v_group, from_location, to_location, v_from_qty, v_from_new, now()
  ) returning id into v_out_id;

  insert into public.movements(
    item_id, location, direction, quantity, memo, created_by, idempotency_key, transfer_group_id, from_location, to_location, opening, closing, created_at
  ) values (
    v_item_id, to_location, 'TRANSFER', v_qty, memo, created_by, v_idem || '-in', v_group, from_location, to_location, v_to_qty, v_to_new, now()
  ) returning id into v_in_id;

  return json_build_object(
    'ok', true,
    'transfer_group_id', v_group,
    'item_id', v_item_id,
    'from_quantity', v_from_new,
    'to_quantity', v_to_new,
    'out_movement_id', v_out_id,
    'in_movement_id', v_in_id
  );
exception
  when others then
    raise;
end;
$$ language plpgsql security definer;

create or replace function public.record_transfer_bulk(
  artist text,
  category text,
  album_version text,
  option text,
  barcode text default null,
  from_location text,
  to_location text,
  quantity integer,
  memo text,
  created_by uuid,
  idempotency_key text
) returns void as $$
#variable_conflict use_variable
declare
  v_idem text := nullif(btrim(idempotency_key), '');
  v_barcode text := nullif(btrim(barcode), '');
begin
  if v_idem is null then
    raise exception 'idempotency_key is required';
  end if;

  if memo is null or btrim(memo) = '' then
    raise exception 'memo is required';
  end if;

  perform public.record_movement(
    album_version,
    artist,
    category,
    created_by,
    'OUT',
    v_idem || '-out',
    from_location,
    memo,
    option,
    quantity
  );

  perform public.record_movement(
    album_version,
    artist,
    category,
    created_by,
    'IN',
    v_idem || '-in',
    to_location,
    memo,
    option,
    quantity
  );

  if v_barcode is not null then
    update public.items
       set barcode = v_barcode
     where items.artist = artist
       and items.category = category
       and items.album_version = album_version
       and items.option = option;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function public.record_transfer_bulk(
  text, text, text, text, text, text, text, integer, text, uuid, text
) to authenticated, service_role;

grant execute on function public.record_transfer(
  text, text, text, text, text, text, integer, text, uuid, text, text
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
alter table if exists public.items enable row level security;

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

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'items' and policyname = 'items_select_authenticated'
  ) then
    create policy items_select_authenticated on public.items for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'items' and policyname = 'items_update_barcode_admin_or_empty'
  ) then
    create policy items_update_barcode_admin_or_empty
      on public.items
      for update
      to authenticated
      using (
        barcode is null
        or exists (
          select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'
        )
      )
      with check (true);
  end if;
end;
$$;
