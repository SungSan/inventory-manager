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
  password_hash text not null,
  role public.user_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

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
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists admin_logs_created_at_idx on public.admin_logs(created_at desc);

-- materialized views
create or replace view public.inventory_view as
select i.artist, i.category, i.album_version, i.option, inv.location, inv.quantity
from public.inventory inv
join public.items i on inv.item_id = i.id;

create or replace view public.movements_view as
select m.created_at, m.direction, i.artist, i.category, i.album_version, i.option, m.location, m.quantity, m.memo, m.created_by
from public.movements m
join public.items i on m.item_id = i.id
order by m.created_at desc;

-- transactional movement function
create or replace function public.record_movement(
  artist text,
  category text,
  album_version text,
  option text,
  location text,
  quantity int,
  direction text,
  memo text default '',
  created_by uuid default null,
  idempotency_key text default null
) returns json as $$
declare
  v_item_id uuid;
  v_existing int;
  v_new int;
begin
  if direction not in ('IN','OUT','ADJUST') then
    raise exception 'invalid direction';
  end if;

  if idempotency_key is not null then
    insert into public.idempotency_keys(key, created_by) values(idempotency_key, created_by)
    on conflict do nothing;
    if not found then
      return json_build_object('ok', true, 'idempotent', true);
    end if;
  end if;

  -- ensure item
  insert into public.items(artist, category, album_version, option)
    values(public.record_movement.artist, category, album_version, option)
  on conflict (artist, category, album_version, option)
    do update set artist = excluded.artist
  returning id into v_item_id;

  -- lock inventory row
  insert into public.inventory(item_id, location, quantity)
    values(v_item_id, location, 0)
  on conflict (item_id, location) do nothing;

  select quantity into v_existing
    from public.inventory
   where item_id = v_item_id
     and location = public.record_movement.location
   for update;

  if direction = 'OUT' and v_existing < quantity then
    raise exception 'insufficient stock';
  end if;

  if direction = 'IN' then
    v_new := v_existing + quantity;
  elsif direction = 'OUT' then
    v_new := v_existing - quantity;
  else
    v_new := quantity; -- for ADJUST quantity represents final desired count
  end if;

  update public.inventory
     set quantity = v_new,
         updated_at = now()
   where item_id = v_item_id
     and location = public.record_movement.location;
  insert into public.movements(item_id, location, direction, quantity, memo, created_by, idempotency_key, opening, closing)
    values(v_item_id, location, direction, quantity, memo, created_by, idempotency_key, v_existing, v_new);

  return json_build_object('ok', true, 'opening', v_existing, 'closing', v_new);
end;
$$ language plpgsql security definer;

-- credential verification via database-side crypt
create extension if not exists pgcrypto;

create or replace function public.verify_login(
  p_email text,
  p_password text
) returns table(
  id uuid,
  email text,
  role public.user_role
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email, u.role
  from public.users u
  where lower(u.email) = lower(p_email)
    and u.active = true
    and u.password_hash = crypt(p_password, u.password_hash)
  limit 1;
$$;

revoke all on function public.verify_login(text, text) from public;
grant execute on function public.verify_login(text, text) to service_role;

-- admin user provisioning with database-side hashing
create or replace function public.create_user(
  p_email text,
  p_password text,
  p_role public.user_role default 'operator'
) returns table(
  id uuid,
  email text,
  role public.user_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(p_email));
  selected_role public.user_role := coalesce(p_role, 'operator');
begin
  if coalesce(p_email, '') = '' or coalesce(p_password, '') = '' then
    raise exception 'email and password are required';
  end if;

  insert into public.users(email, password_hash, role, active)
  values(normalized_email, crypt(p_password, gen_salt('bf')), selected_role, true)
  on conflict (email) do update
    set password_hash = excluded.password_hash,
        role = excluded.role,
        active = true
  returning users.id, users.email, users.role into id, email, role;

  return next;
end;
$$;

revoke all on function public.create_user(text, text, public.user_role) from public;
grant execute on function public.create_user(text, text, public.user_role) to service_role;

-- smoke test
-- select * from public.inventory_view limit 1;
-- select public.record_movement('A','album','v1','', 'loc1', 1, 'IN', 'test', null, 'k1');
