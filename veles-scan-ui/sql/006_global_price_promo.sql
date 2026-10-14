ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS default_project_old_price_rub INTEGER,
  ADD COLUMN IF NOT EXISTS project_price_promo_message TEXT;

UPDATE system_settings
SET project_price_promo_message = NULL
WHERE default_project_old_price_rub IS NULL;