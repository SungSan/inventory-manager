-- Ensure barcode-ready inventory/movement views and l_operator role

-- add barcode column for compatibility
alter table if exists public.items
  add column if not exists barcode text;

-- add l_operator enum value if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role'
      AND e.enumlabel = 'l_operator'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'l_operator';
  END IF;
END$$;

-- rebuild inventory_view with identifiers and barcode
DROP VIEW IF EXISTS public.movements_view;
DROP VIEW IF EXISTS public.inventory_view;

CREATE VIEW public.inventory_view AS
SELECT
  inv.id AS inventory_id,
  inv.item_id,
  i.artist,
  i.category,
  i.album_version,
  i.option,
  i.barcode,
  inv.location,
  inv.quantity
FROM public.inventory inv
JOIN public.items i ON inv.item_id = i.id;

-- rebuild movements_view with barcode and transfer metadata
CREATE VIEW public.movements_view AS
SELECT
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
  COALESCE(p.full_name, u.email, m.created_by::text, '') AS created_by_name,
  COALESCE(p.department, '') AS created_by_department
FROM public.movements m
JOIN public.items i ON i.id = m.item_id
LEFT JOIN public.users u ON u.id = m.created_by
LEFT JOIN public.user_profiles p ON p.user_id = m.created_by;

GRANT SELECT ON public.movements_view TO authenticated, anon;
GRANT SELECT ON public.inventory_view TO authenticated, anon;

SELECT pg_notify('pgrst', 'reload schema');
