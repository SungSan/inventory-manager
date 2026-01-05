-- Ensure enum includes l_operator
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

-- Location scope table
CREATE TABLE IF NOT EXISTS public.user_location_permissions (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  primary_location text NOT NULL,
  sub_locations text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_user_location_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_touch_user_location_permissions'
  ) THEN
    CREATE TRIGGER trg_touch_user_location_permissions
    BEFORE UPDATE ON public.user_location_permissions
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_user_location_permissions();
  END IF;
END$$;

-- Items barcode
ALTER TABLE IF EXISTS public.items
  ADD COLUMN IF NOT EXISTS barcode text;

-- Movements transfer metadata
ALTER TABLE IF EXISTS public.movements
  ADD COLUMN IF NOT EXISTS from_location text;
ALTER TABLE IF EXISTS public.movements
  ADD COLUMN IF NOT EXISTS to_location text;
ALTER TABLE IF EXISTS public.movements
  ADD COLUMN IF NOT EXISTS transfer_group_id uuid;
ALTER TABLE IF EXISTS public.movements
  ADD COLUMN IF NOT EXISTS barcode text;

-- Backfill legacy rows for compatibility
UPDATE public.movements
   SET from_location = COALESCE(from_location, location)
 WHERE direction = 'OUT'
   AND (from_location IS NULL OR from_location = '');

UPDATE public.movements
   SET to_location = COALESCE(to_location, location)
 WHERE direction = 'IN'
   AND (to_location IS NULL OR to_location = '');

-- Rebuild views with required columns
DROP VIEW IF EXISTS public.inventory_view CASCADE;
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

DROP VIEW IF EXISTS public.movements_view CASCADE;
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

GRANT SELECT ON public.inventory_view TO authenticated, anon;
GRANT SELECT ON public.movements_view TO authenticated, anon;

SELECT pg_notify('pgrst', 'reload schema');
