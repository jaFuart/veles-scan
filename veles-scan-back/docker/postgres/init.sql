CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    job_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    input_bucket VARCHAR(255),
    input_key VARCHAR(1024),
    result_bucket VARCHAR(255),
    result_key VARCHAR(1024),
    error_message TEXT,
    progress INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_events (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL,
    stage VARCHAR(128),
    status VARCHAR(32) NOT NULL,
    message TEXT,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_id VARCHAR(255) PRIMARY KEY,
    worker_role VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    current_job_id UUID,
    message TEXT,
    queue_depth INTEGER,
    host VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker_heartbeat_events (
    id BIGSERIAL PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    worker_role VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    current_job_id UUID,
    message TEXT,
    queue_depth INTEGER,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intent_resolution_cache (
    cache_key VARCHAR(128) PRIMARY KEY,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_updated_at ON worker_heartbeats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeat_events_worker_id ON worker_heartbeat_events(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_resolution_cache_expires_at ON intent_resolution_cache(expires_at);
