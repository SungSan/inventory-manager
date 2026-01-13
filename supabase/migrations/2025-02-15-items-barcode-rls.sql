create unique index if not exists items_barcode_ux on public.items(barcode) where barcode is not null;

alter table if exists public.items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'items' and policyname = 'items_select_authenticated'
  ) then
    create policy items_select_authenticated on public.items for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'items' and policyname = 'items_update_barcode_admin_or_empty'
  ) then
    create policy items_update_barcode_admin_or_empty
      on public.items
      for update
      to authenticated
      using (
        barcode is null
        or exists (
          select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'
        )
      )
      with check (true);
  end if;
end;
$$;
