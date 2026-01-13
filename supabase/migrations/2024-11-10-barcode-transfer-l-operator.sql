-- Add barcode support, transfer grouping, location-scoped roles, and transfer RPC

-- Add barcode column to items (nullable for backward compatibility)
alter table if exists public.items
  add column if not exists barcode text;

-- Extend user_role enum with l_operator if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'user_role' AND e.enumlabel = 'l_operator') THEN
    ALTER TYPE public.user_role ADD VALUE 'l_operator';
  END IF;
END$$;

-- Location permissions for limited operators
create table if not exists public.user_location_permissions (
  user_id uuid primary key references public.users(id) on delete cascade,
  primary_location text not null,
  sub_locations text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- helper trigger to keep updated_at fresh
create or replace function public.touch_user_location_permissions()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_touch_user_location_permissions'
  ) THEN
    CREATE TRIGGER trg_touch_user_location_permissions
    BEFORE UPDATE ON public.user_location_permissions
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_user_location_permissions();
  END IF;
END$$;

-- Transfer grouping and metadata
alter table if exists public.movements
  add column if not exists transfer_group_id uuid,
  add column if not exists from_location text,
  add column if not exists to_location text;

-- record_movement with optional barcode to keep item metadata fresh
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
  barcode text default null
) returns json as $$
#variable_conflict use_variable
DECLARE
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
BEGIN
  IF v_direction NOT IN ('IN','OUT','ADJUST') THEN
    RAISE EXCEPTION 'invalid direction';
  END IF;

  IF v_idem IS NOT NULL THEN
    SELECT id, item_id, opening, closing
      INTO v_movement_id, v_item_id, v_existing_opening, v_existing_closing
      FROM public.movements
     WHERE idempotency_key = v_idem;

    IF FOUND THEN
      RETURN json_build_object(
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
    END IF;
  END IF;

  INSERT INTO public.items AS i (artist, category, album_version, option, barcode)
  VALUES (v_artist, category, v_album, v_option, barcode)
  ON CONFLICT (artist, category, album_version, option)
  DO UPDATE SET barcode = COALESCE(excluded.barcode, i.barcode)
  RETURNING i.id INTO v_item_id;

  INSERT INTO public.inventory(item_id, location, quantity)
  VALUES (v_item_id, v_location, 0)
  ON CONFLICT (item_id, location) DO NOTHING;

  SELECT quantity
    INTO v_existing
    FROM public.inventory
   WHERE item_id = v_item_id
     AND location = v_location
   FOR UPDATE;

  IF v_direction = 'OUT' THEN
    v_new := v_existing - v_qty;
  ELSIF v_direction = 'IN' THEN
    v_new := v_existing + v_qty;
  ELSE
    v_new := v_qty;
  END IF;

  UPDATE public.inventory
     SET quantity = v_new,
         updated_at = now()
   WHERE item_id = v_item_id
     AND location = v_location;

  GET DIAGNOSTICS v_rowcount = row_count;
  IF v_rowcount <= 0 THEN
    RAISE EXCEPTION 'inventory update failed';
  END IF;

  INSERT INTO public.movements(
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
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_movement_id;

  IF v_movement_id IS NULL THEN
    RAISE EXCEPTION 'idempotency conflict';
  END IF;

  RETURN json_build_object(
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
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Transfer RPC to move stock between locations atomically
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
DECLARE
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
BEGIN
  IF v_idem IS NOT NULL THEN
    SELECT transfer_group_id
      INTO v_group
      FROM public.movements
     WHERE idempotency_key = v_idem
       AND direction = 'TRANSFER'
     LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('ok', true, 'idempotent', true, 'transfer_group_id', v_group);
    END IF;
  END IF;

  INSERT INTO public.items AS i (artist, category, album_version, option, barcode)
  VALUES (artist, category, album_version, option, barcode)
  ON CONFLICT (artist, category, album_version, option)
  DO UPDATE SET barcode = COALESCE(excluded.barcode, i.barcode)
  RETURNING i.id INTO v_item_id;

  INSERT INTO public.inventory(item_id, location, quantity)
  VALUES (v_item_id, from_location, 0)
  ON CONFLICT (item_id, location) DO NOTHING;

  INSERT INTO public.inventory(item_id, location, quantity)
  VALUES (v_item_id, to_location, 0)
  ON CONFLICT (item_id, location) DO NOTHING;

  SELECT quantity INTO v_from_qty FROM public.inventory WHERE item_id = v_item_id AND location = from_location FOR UPDATE;
  SELECT quantity INTO v_to_qty FROM public.inventory WHERE item_id = v_item_id AND location = to_location FOR UPDATE;

  v_from_new := v_from_qty - v_qty;
  v_to_new := v_to_qty + v_qty;

  UPDATE public.inventory SET quantity = v_from_new, updated_at = now() WHERE item_id = v_item_id AND location = from_location;
  UPDATE public.inventory SET quantity = v_to_new, updated_at = now() WHERE item_id = v_item_id AND location = to_location;

  INSERT INTO public.movements(
    item_id, location, direction, quantity, memo, created_by, idempotency_key, transfer_group_id, from_location, to_location, opening, closing, created_at
  ) values (
    v_item_id, from_location, 'TRANSFER', v_qty, memo, created_by, v_idem || '-out', v_group, from_location, to_location, v_from_qty, v_from_new, now()
  ) RETURNING id INTO v_out_id;

  INSERT INTO public.movements(
    item_id, location, direction, quantity, memo, created_by, idempotency_key, transfer_group_id, from_location, to_location, opening, closing, created_at
  ) values (
    v_item_id, to_location, 'TRANSFER', v_qty, memo, created_by, v_idem || '-in', v_group, from_location, to_location, v_to_qty, v_to_new, now()
  ) RETURNING id INTO v_in_id;

  RETURN json_build_object(
    'ok', true,
    'transfer_group_id', v_group,
    'item_id', v_item_id,
    'from_quantity', v_from_new,
    'to_quantity', v_to_new,
    'out_movement_id', v_out_id,
    'in_movement_id', v_in_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- refresh inventory_view to expose identifiers and barcode (order preserved)
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

-- refresh movements_view to include transfer metadata
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

select pg_notify('pgrst', 'reload schema');
