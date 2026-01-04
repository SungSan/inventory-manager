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
  password_hash text,
  role public.user_role not null default 'viewer',
  approved boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- user profile extensions (idempotent)
alter table public.users add column if not exists full_name text default '';
alter table public.users add column if not exists department text default '';
alter table public.users add column if not exists contact text default '';
alter table public.users add column if not exists purpose text default '';
update public.users set full_name = coalesce(nullif(full_name, ''), email) where full_name is null or full_name = '';
update public.users set department = coalesce(department, '');
update public.users set contact = coalesce(contact, '');
update public.users set purpose = coalesce(purpose, '');
alter table public.users alter column full_name set not null;
alter table public.users alter column department set not null;
alter table public.users alter column role set default 'viewer';
alter table public.users alter column password_hash drop not null;
alter table public.users add column if not exists approved boolean not null default false;

create table if not exists public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  username text not null unique,
  approved boolean not null default false,
  role public.user_role not null default 'viewer',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.users(id)
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
  u.created_at
from public.users u
left join public.user_profiles p on p.user_id = u.id;

create or replace view public.inventory_view as
select i.artist, i.category, i.album_version, i.option, inv.location, inv.quantity
from public.inventory inv
join public.items i on inv.item_id = i.id;

drop view if exists public.movements_view;
create view public.movements_view as
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
  coalesce(up.full_name, u.email, m.created_by::text, '') as created_by_name
from public.movements m
left join public.items i on i.id = m.item_id
left join public.users u on u.id = m.created_by
left join public.user_profiles up on up.user_id = u.id
order by m.created_at desc;

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
  p_role public.user_role default 'operator',
  p_full_name text default '',
  p_department text default '',
  p_contact text default '',
  p_purpose text default ''
) returns table(
  id uuid,
  email text,
  role public.user_role,
  full_name text,
  department text
) 
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(p_email));
  selected_role public.user_role := coalesce(p_role, 'operator');
  normalized_name text := coalesce(nullif(trim(p_full_name), ''), normalized_email);
  normalized_department text := coalesce(nullif(trim(p_department), ''), '');
  normalized_contact text := coalesce(nullif(trim(p_contact), ''), '');
  normalized_purpose text := coalesce(nullif(trim(p_purpose), ''), '');
begin
  if coalesce(p_email, '') = '' or coalesce(p_password, '') = '' then
    raise exception 'login id and password are required';
  end if;

  insert into public.users(email, password_hash, role, active, full_name, department, contact, purpose)
  values(
    normalized_email,
    crypt(p_password, gen_salt('bf')),
    selected_role,
    true,
    normalized_name,
    normalized_department,
    normalized_contact,
    normalized_purpose
  )
  on conflict (email) do update
    set password_hash = excluded.password_hash,
        role = excluded.role,
        active = true,
        full_name = excluded.full_name,
        department = excluded.department,
        contact = excluded.contact,
        purpose = excluded.purpose
  returning users.id, users.email, users.role, users.full_name, users.department
  into id, email, role, full_name, department;

  return next;
end;
$$;

revoke all on function public.create_user(text, text, public.user_role) from public;
grant execute on function public.create_user(text, text, public.user_role) to service_role;

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
