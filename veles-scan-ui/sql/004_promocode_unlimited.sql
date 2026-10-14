DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname
  INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'promo_codes'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%max_activations%> 0%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE promo_codes DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'promo_codes'
      AND c.conname = 'promo_codes_max_activations_check'
  ) THEN
    ALTER TABLE promo_codes
      ADD CONSTRAINT promo_codes_max_activations_check
      CHECK (max_activations >= 0);
  END IF;
END $$;