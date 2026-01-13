-- Refresh movements_view to expose id and creator metadata and keep history queries current
create or replace view public.movements_view as
select
  m.id,
  m.created_at,
  m.direction,
  coalesce(i.artist, '') as artist,
  coalesce(i.category, '') as category,
  coalesce(i.album_version, '') as album_version,
  coalesce(i.option, '') as option,
  m.location,
  m.quantity,
  m.memo,
  m.item_id,
  m.created_by,
  coalesce(up.full_name, u.email, m.created_by::text, '') as created_by_name,
  coalesce(up.department, '') as created_by_department
from public.movements m
left join public.items i on i.id = m.item_id
left join public.users u on u.id = m.created_by
left join public.user_profiles up on up.user_id = u.id
order by m.created_at desc;

grant select on public.movements_view to authenticated, service_role;

-- Ensure schema cache sees the refreshed view
select pg_notify('pgrst', 'reload schema');
