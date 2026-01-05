-- Ensure inventory_view exposes inventory and item identifiers for API consumers
create or replace view public.inventory_view as
select
  inv.id as inventory_id,
  inv.item_id,
  i.artist,
  i.category,
  i.album_version,
  i.option,
  inv.location,
  inv.quantity
from public.inventory inv
join public.items i on inv.item_id = i.id;

grant select on public.inventory_view to authenticated, anon;

notify pgrst, 'reload schema';
