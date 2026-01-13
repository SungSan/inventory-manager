-- Ensure movements has from/to locations and rebuild movements_view with transfer fields
alter table public.movements add column if not exists from_location text;
alter table public.movements add column if not exists to_location text;

-- Optional backfill to keep existing records aligned
update public.movements
   set from_location = coalesce(from_location, location)
 where direction = 'OUT'
   and (from_location is null or from_location = '');

update public.movements
   set to_location = coalesce(to_location, location)
 where direction = 'IN'
   and (to_location is null or to_location = '');

drop view if exists public.movements_view;
create view public.movements_view as
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
join public.items i on i.id = m.item_id
left join public.users u on u.id = m.created_by
left join public.user_profiles p on p.user_id = m.created_by;

grant select on public.movements_view to authenticated, anon;

-- Refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
