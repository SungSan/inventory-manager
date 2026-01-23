alter table public.items drop constraint if exists items_barcode_key;

create unique index if not exists items_barcode_scoped_unique
  on public.items (artist, category, album_version, barcode)
  where barcode is not null and btrim(barcode) <> '';
