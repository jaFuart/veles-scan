CREATE TABLE IF NOT EXISTS tbank_topups (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_rub INTEGER NOT NULL CHECK (amount_rub > 0),
  payment_id BIGINT UNIQUE,
  status TEXT NOT NULL DEFAULT 'created',
  payment_url TEXT,
  init_payload JSONB,
  notification_payload JSONB,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbank_topups_user_created ON tbank_topups(user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_tbank_topups_set_updated_at ON tbank_topups;
CREATE TRIGGER trg_tbank_topups_set_updated_at
BEFORE UPDATE ON tbank_topups
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
