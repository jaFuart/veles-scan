ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS price_reasoning_short TEXT,
  ADD COLUMN IF NOT EXISTS price_reasoning_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_last_prompt TEXT,
  ADD COLUMN IF NOT EXISTS pricing_last_prompt_hash TEXT,
  ADD COLUMN IF NOT EXISTS pricing_last_model TEXT,
  ADD COLUMN IF NOT EXISTS pricing_last_source TEXT,
  ADD COLUMN IF NOT EXISTS pricing_last_input_signature TEXT,
  ADD COLUMN IF NOT EXISTS pricing_resolved_okved_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_resolved_output_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_resolved_data_filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS project_price_history (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  previous_price_rub INTEGER NOT NULL CHECK (previous_price_rub >= 0),
  new_price_rub INTEGER NOT NULL CHECK (new_price_rub >= 0),
  delta_rub INTEGER NOT NULL,
  reason_short TEXT,
  reason_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_text TEXT,
  prompt_hash TEXT,
  pricing_model TEXT,
  pricing_source TEXT,
  input_signature TEXT,
  trigger TEXT NOT NULL DEFAULT 'draft_update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_price_history_project_created
  ON project_price_history(project_id, created_at DESC);
