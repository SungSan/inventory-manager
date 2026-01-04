-- transactional user approval/role update
create or replace function public.admin_update_user(
  p_id uuid,
  p_approved boolean default null,
  p_role public.user_role default null,
  p_actor_id uuid default null
) returns admin_users_view as $$
declare
  v_row admin_users_view%rowtype;
  v_count int;
begin
  if p_id is null then
    raise exception 'id is required';
  end if;

  update public.users
     set approved = coalesce(p_approved, approved),
         role = coalesce(p_role, role)
   where id = p_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'user not found';
  end if;

  update public.user_profiles
     set approved = coalesce(p_approved, approved),
         approved_at = case
           when p_approved is true then now()
           when p_approved is false then null
           else approved_at
         end,
         approved_by = case
           when p_approved is true then p_actor_id
           when p_approved is false then null
           else approved_by
         end
   where user_id = p_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'user profile not found';
  end if;

  select * into v_row from public.admin_users_view where id = p_id;
  if not found then
    raise exception 'user not found in admin_users_view';
  end if;

  return v_row;
exception
  when others then
    raise;
end;
$$ language plpgsql security definer;
