-- Apply movement with transactional inventory update and idempotency
create unique index if not exists movements_idempotency_key_uniq
  on public.movements (idempotency_key) where idempotency_key is not null;

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
