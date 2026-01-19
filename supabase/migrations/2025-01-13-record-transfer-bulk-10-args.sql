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
