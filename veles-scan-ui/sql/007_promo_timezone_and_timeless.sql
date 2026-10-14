ALTER TABLE promo_codes
  ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS expires_timezone TEXT;

UPDATE promo_codes
SET expires_timezone = COALESCE(expires_timezone, current_setting('TIMEZONE'))
WHERE expires_at IS NOT NULL;