-- Add user profile detail columns and expose active status in admin view
alter table public.user_profiles add column if not exists full_name text default '';
alter table public.user_profiles add column if not exists department text default '';
alter table public.user_profiles add column if not exists contact text default '';
alter table public.user_profiles add column if not exists purpose text default '';

update public.user_profiles
set
  full_name = coalesce(full_name, ''),
  department = coalesce(department, ''),
  contact = coalesce(contact, ''),
  purpose = coalesce(purpose, '')
where full_name is null
   or department is null
   or contact is null
   or purpose is null;

create or replace view public.admin_users_view as
select
  u.id,
  u.email,
  coalesce(p.full_name, u.email, '') as full_name,
  coalesce(p.department, '') as department,
  coalesce(p.contact, '') as contact,
  coalesce(p.purpose, '') as purpose,
  u.role,
  coalesce(u.approved, false) as approved,
  u.active,
  u.created_at
from public.users u
left join public.user_profiles p on p.user_id = u.id;
