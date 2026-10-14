#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$UI_ROOT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.unified.yml"
DC=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

DB_NAME="veles_ui"
DB_USER="${POSTGRES_USER:-}"

read_env_var() {
  local key="$1"
  local default_value="$2"
  local line value
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)
  if [[ -z "$line" ]]; then
    echo "$default_value"
    return
  fi
  value="${line#*=}"
  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi
  echo "$value"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

DB_USER="${DB_USER:-$(read_env_var POSTGRES_USER pipeline)}"

if ! "${DC[@]}" ps --status running postgres | grep -q "postgres"; then
  echo "Service postgres is not running in unified stack. Start with: $ROOT_DIR/start.sh"
  exit 1
fi

for _ in {1..30}; do
  if "${DC[@]}" exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! "${DC[@]}" exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  echo "PostgreSQL is not ready in unified stack"
  exit 1
fi

"${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /sql-ui/003_analytics.sql
"${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /sql-ui/004_promocode_unlimited.sql
"${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /sql-ui/005_global_settings_and_project_price.sql
"${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /sql-ui/006_global_price_promo.sql
"${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /sql-ui/007_promo_timezone_and_timeless.sql
"${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /sql-ui/009_tbank_topups.sql
"${DC[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f /sql-ui/002_seed_test_data.sql

echo "Test data loaded into $DB_NAME"
