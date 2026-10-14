CREATE TABLE IF NOT EXISTS system_analytics_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_minute TIMESTAMPTZ NOT NULL UNIQUE,
  users_total INTEGER NOT NULL,
  total_balance_rub BIGINT NOT NULL,
  projects_new INTEGER NOT NULL,
  projects_working INTEGER NOT NULL,
  projects_done INTEGER NOT NULL,
  projects_error INTEGER NOT NULL,
  working_projects_by_user JSONB NOT NULL DEFAULT '[]'::jsonb,
  working_project_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_analytics_snapshot_minute_desc
  ON system_analytics_snapshots (snapshot_minute DESC);

CREATE OR REPLACE FUNCTION refresh_system_analytics_snapshot()
RETURNS VOID AS $$
DECLARE
  now_minute TIMESTAMPTZ := date_trunc('minute', NOW());
BEGIN
  INSERT INTO system_analytics_snapshots (
    snapshot_minute,
    users_total,
    total_balance_rub,
    projects_new,
    projects_working,
    projects_done,
    projects_error,
    working_projects_by_user,
    working_project_list
  )
  SELECT
    now_minute,
    (SELECT COUNT(*)::int FROM users),
    (SELECT COALESCE(SUM(balance_rub), 0)::bigint FROM users),
    (SELECT COUNT(*)::int FROM projects WHERE status = 'new'),
    (SELECT COUNT(*)::int FROM projects WHERE status = 'working'),
    (SELECT COUNT(*)::int FROM projects WHERE status = 'done'),
    (SELECT COUNT(*)::int FROM projects WHERE status = 'error'),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'userId', t.user_id,
          'fullName', t.full_name,
          'email', t.email,
          'workingProjects', t.working_projects
        )
        ORDER BY t.working_projects DESC, t.full_name ASC
      )
      FROM (
        SELECT
          u.id AS user_id,
          COALESCE(u.full_name, 'Пользователь') AS full_name,
          u.email,
          COUNT(*)::int AS working_projects
        FROM projects p
        JOIN users u ON u.id = p.user_id
        WHERE p.status = 'working'
        GROUP BY u.id, u.full_name, u.email
      ) t
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'projectId', p.id,
          'title', p.title,
          'userId', u.id,
          'fullName', COALESCE(u.full_name, 'Пользователь'),
          'email', u.email
        )
        ORDER BY p.updated_at DESC
      )
      FROM projects p
      JOIN users u ON u.id = p.user_id
      WHERE p.status = 'working'
    ), '[]'::jsonb)
  ON CONFLICT (snapshot_minute)
  DO UPDATE SET
    users_total = EXCLUDED.users_total,
    total_balance_rub = EXCLUDED.total_balance_rub,
    projects_new = EXCLUDED.projects_new,
    projects_working = EXCLUDED.projects_working,
    projects_done = EXCLUDED.projects_done,
    projects_error = EXCLUDED.projects_error,
    working_projects_by_user = EXCLUDED.working_projects_by_user,
    working_project_list = EXCLUDED.working_project_list,
    created_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refresh_system_analytics_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_system_analytics_snapshot();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_refresh_system_analytics ON users;
CREATE TRIGGER trg_users_refresh_system_analytics
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_system_analytics_snapshot();

DROP TRIGGER IF EXISTS trg_projects_refresh_system_analytics ON projects;
CREATE TRIGGER trg_projects_refresh_system_analytics
AFTER INSERT OR UPDATE OR DELETE ON projects
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_system_analytics_snapshot();

SELECT refresh_system_analytics_snapshot();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION
      WHEN others THEN NULL;
    END;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname = 'refresh_system_analytics_every_10_minutes'
      ) THEN
        PERFORM cron.schedule(
          'refresh_system_analytics_every_10_minutes',
          '*/10 * * * *',
          $job$SELECT refresh_system_analytics_snapshot();$job$
        );
      END IF;
    END IF;
  END IF;
END $$;