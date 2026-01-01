create extension if not exists pgcrypto;

-- Roles
create type user_role as enum ('admin','operator','viewer');

drop table if exists users cascade;
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role user_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

drop table if exists items cascade;
create table items (
  id uuid primary key default gen_random_uuid(),
  artist text not null,
  category text not null,
  album_version text not null,
  option text not null default ''
);
create unique index items_unique ON items(artist, category, album_version, option);

drop table if exists inventory cascade;
create table inventory (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  location text not null,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint inventory_unique unique (item_id, location)
);

drop table if exists movements cascade;
create table movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  location text not null,
  direction text not null check (direction in ('IN','OUT','ADJUST')),
  quantity integer not null,
  memo text default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  idempotency_key text unique,
  opening integer,
  closing integer
);

-- idempotency guard
create table idempotency_keys (
  key text primary key,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- materialized views
create or replace view inventory_view as
select i.artist, i.category, i.album_version, i.option, inv.location, inv.quantity
from inventory inv
join items i on inv.item_id = i.id;

create or replace view movements_view as
select m.created_at, m.direction, i.artist, i.category, i.album_version, i.option, m.location, m.quantity, m.memo, m.created_by
from movements m
join items i on m.item_id = i.id
order by m.created_at desc;

-- transactional movement function
create or replace function record_movement(
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
    insert into idempotency_keys(key, created_by) values(idempotency_key, created_by)
    on conflict do nothing;
    if not found then
      return json_build_object('ok', true, 'idempotent', true);
    end if;
  end if;

  -- ensure item
  insert into items(artist, category, album_version, option)
    values(record_movement.artist, category, album_version, option)
  on conflict (artist, category, album_version, option)
    do update set artist = excluded.artist
  returning id into v_item_id;

  -- lock inventory row
  insert into inventory(item_id, location, quantity)
    values(v_item_id, location, 0)
  on conflict (item_id, location) do nothing;

  select quantity into v_existing
    from inventory
   where item_id = v_item_id
     and location = record_movement.location
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

  update inventory
     set quantity = v_new,
         updated_at = now()
   where item_id = v_item_id
     and location = record_movement.location;
  insert into movements(item_id, location, direction, quantity, memo, created_by, idempotency_key, opening, closing)
    values(v_item_id, location, direction, quantity, memo, created_by, idempotency_key, v_existing, v_new);

  return json_build_object('ok', true, 'opening', v_existing, 'closing', v_new);
end;
$$ language plpgsql security definer;
