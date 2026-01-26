drop index if exists public.items_barcode_key;

create unique index if not exists items_barcode_scoped_unique
  on public.items (artist, category, album_version, barcode)
  where barcode is not null and btrim(barcode) <> '';
