CREATE TABLE IF NOT EXISTS system_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_project_price_rub INTEGER NOT NULL CHECK (default_project_price_rub >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (id, default_project_price_rub)
VALUES (1, 1488)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_price_rub INTEGER;

UPDATE projects
SET project_price_rub = COALESCE(
  project_price_rub,
  (SELECT default_project_price_rub FROM system_settings WHERE id = 1),
  1488
)
WHERE project_price_rub IS NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE projects ALTER COLUMN project_price_rub SET NOT NULL;
  EXCEPTION
    WHEN others THEN NULL;
  END;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS trg_system_settings_set_updated_at ON system_settings;
    CREATE TRIGGER trg_system_settings_set_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;