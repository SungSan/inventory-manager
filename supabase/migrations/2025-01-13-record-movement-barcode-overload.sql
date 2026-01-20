-- Ensure record_movement base signature remains barcode-free and add barcode overload
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
