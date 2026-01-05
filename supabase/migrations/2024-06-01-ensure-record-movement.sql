-- Ensure record_movement function exists with expected signature and allows negative stock
create or replace function public.record_movement(
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
