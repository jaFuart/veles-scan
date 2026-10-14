#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Veles Scan — one-command launcher
#  Usage:
#    ./start.sh             Start everything (build if needed)
#    ./start.sh --seed      Also load test data into UI database
#    ./start.sh --rebuild   Force rebuild all images before starting
#    ./start.sh --down      Stop all services
#    ./start.sh --reset     Destroy volumes and start from scratch
#    ./start.sh --logs      Tail all service logs
#    ./start.sh --status    Show service status
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${BLUE}▶${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
die()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.unified.yml"
ENV_FILE="$SCRIPT_DIR/.env"
PROJECT_NAME="veles-scan"
DC="docker compose --project-name $PROJECT_NAME --env-file $ENV_FILE -f $COMPOSE_FILE"
AUTOSCALER_SCRIPT="$SCRIPT_DIR/autoscale-workers.sh"
AUTOSCALER_PID_FILE="$SCRIPT_DIR/.autoscaler.pid"
AUTOSCALER_LOG_DIR="$SCRIPT_DIR/runtime"
AUTOSCALER_LOG_FILE="$AUTOSCALER_LOG_DIR/autoscaler.log"

ensure_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
    warn "Created .env from .env.example"
    warn "Edit .env and set OPENAI_API_KEY to enable intent-based search,"
    warn "then re-run this script."
    echo ""
  fi
}

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
  # Trim optional single/double quotes around the whole value.
  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi
  echo "$value"
}

resolve_path() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    echo "$path"
  else
    echo "$SCRIPT_DIR/$path"
  fi
}

# ── argument parsing ──────────────────────────────────────────────────────────
MODE="up"
SEED=false
REBUILD=false

for arg in "$@"; do
  case "$arg" in
    --seed)    SEED=true ;;
    --rebuild) REBUILD=true ;;
    --down)    MODE="down" ;;
    --reset)   MODE="reset" ;;
    --logs)    MODE="logs" ;;
    --status)  MODE="status" ;;
    -h|--help)
      echo -e "${BOLD}Usage:${NC} $0 [option]"
      echo ""
      echo "  (no args)   Build images (if needed) and start all services"
      echo "  --seed      Also load test/demo data into UI database"
      echo "  --rebuild   Force rebuild all images before starting"
      echo "  --down      Stop all services (keep data volumes)"
      echo "  --reset     Stop services AND destroy all data volumes"
      echo "  --logs      Tail logs for all services"
      echo "  --status    Show which services are running"
      exit 0 ;;
    *) die "Unknown option: $arg  Run $0 --help for usage." ;;
  esac
done

ensure_env_file

is_autoscaler_running() {
  if [[ ! -f "$AUTOSCALER_PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$AUTOSCALER_PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 1
  fi
  local cmdline
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmdline" == *"autoscale-workers.sh"* ]]
}

stop_autoscaler() {
  local pid=""
  if [[ -f "$AUTOSCALER_PID_FILE" ]]; then
    pid="$(cat "$AUTOSCALER_PID_FILE" 2>/dev/null || true)"
  fi
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    log "Stopping worker autoscaler (pid=$pid)…"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
  fi
  pkill -f "autoscale-workers.sh --project-name $PROJECT_NAME" >/dev/null 2>&1 || true
  rm -f "$AUTOSCALER_PID_FILE"
  ok "Worker autoscaler stopped."
}

start_autoscaler() {
  local enabled
  enabled="$(read_env_var AUTO_SCALING_ENABLED true)"
  case "${enabled,,}" in
    1|true|yes|on) ;;
    *)
      warn "Worker autoscaler is disabled (AUTO_SCALING_ENABLED=$enabled)."
      return
      ;;
  esac

  if [[ ! -x "$AUTOSCALER_SCRIPT" ]]; then
    die "Autoscaler script is missing or not executable: $AUTOSCALER_SCRIPT"
  fi

  if is_autoscaler_running; then
    local pid
    pid="$(cat "$AUTOSCALER_PID_FILE")"
    ok "Worker autoscaler already running (pid=$pid)."
    return
  fi

  mkdir -p "$AUTOSCALER_LOG_DIR"
  log "Starting worker autoscaler…"
  nohup "$AUTOSCALER_SCRIPT" \
    --project-name "$PROJECT_NAME" \
    --compose-file "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    >> "$AUTOSCALER_LOG_FILE" 2>&1 &
  local launcher_pid=$!
  sleep 1
  local worker_pid
  worker_pid="$(pgrep -f "autoscale-workers.sh --project-name $PROJECT_NAME" | head -n1 || true)"
  if [[ -n "$worker_pid" ]]; then
    echo "$worker_pid" > "$AUTOSCALER_PID_FILE"
    ok "Worker autoscaler started (pid=$worker_pid, log=$AUTOSCALER_LOG_FILE)."
    return
  fi
  echo "$launcher_pid" > "$AUTOSCALER_PID_FILE"
  if is_autoscaler_running; then
    ok "Worker autoscaler started (pid=$launcher_pid, log=$AUTOSCALER_LOG_FILE)."
  else
    warn "Worker autoscaler failed to start. Check log: $AUTOSCALER_LOG_FILE"
  fi
}

# ── simple utility modes ──────────────────────────────────────────────────────
if [[ "$MODE" == "down" ]]; then
  stop_autoscaler
  log "Stopping all services…"
  $DC down
  ok "Done."
  exit 0
fi

if [[ "$MODE" == "logs" ]]; then
  exec $DC logs -f
fi

if [[ "$MODE" == "status" ]]; then
  $DC ps
  if is_autoscaler_running; then
    ok "Worker autoscaler is running (pid=$(cat "$AUTOSCALER_PID_FILE"))."
    echo -e "   log: ${AUTOSCALER_LOG_FILE}"
  else
    warn "Worker autoscaler is not running."
  fi
  exit 0
fi

if [[ "$MODE" == "reset" ]]; then
  warn "This will DELETE all data (postgres, minio, rabbitmq volumes)."
  read -r -p "Type 'yes' to confirm: " confirm
  [[ "$confirm" == "yes" ]] || die "Aborted."
  stop_autoscaler
  log "Removing services and volumes…"
  $DC down -v --remove-orphans
  ok "Volumes removed. Starting fresh."
  REBUILD=true
fi

# ── preflight ─────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Desktop or Docker Engine first."
docker info >/dev/null 2>&1       || die "Docker daemon is not running."

PG_USER="$(read_env_var POSTGRES_USER pipeline)"
PG_PASS="$(read_env_var POSTGRES_PASSWORD pipeline)"
RMQ_USER="$(read_env_var RABBITMQ_USER pipeline)"
RMQ_PASS="$(read_env_var RABBITMQ_PASSWORD pipeline)"
MINIO_USER="$(read_env_var MINIO_ROOT_USER minioadmin)"
MINIO_PASS="$(read_env_var MINIO_ROOT_PASSWORD minioadmin)"

retry_cmd() {
  local attempts="$1"
  local delay_sec="$2"
  shift 2

  local try=1
  while true; do
    if "$@"; then
      return 0
    fi

    if [[ "$try" -ge "$attempts" ]]; then
      return 1
    fi

    warn "Command failed (attempt $try/$attempts): $*"
    sleep "$delay_sec"
    try=$((try + 1))
  done
}

ensure_rabbit_topology() {
  log "Ensuring RabbitMQ exchanges/queues/bindings…"

  # Clear all definitions by resetting the node if needed
  $DC exec -T rabbitmq bash -c 'rabbitmqctl reset || true' 2>/dev/null || true

  # Now declare exchanges and queues
  $DC exec -T rabbitmq rabbitmqadmin -u "$RMQ_USER" -p "$RMQ_PASS" \
    declare exchange name=jobs.exchange type=direct durable=true auto_delete=false internal=false >/dev/null

  $DC exec -T rabbitmq rabbitmqadmin -u "$RMQ_USER" -p "$RMQ_PASS" \
    declare exchange name=jobs.dlx type=topic durable=true auto_delete=false internal=false >/dev/null

  for queue in jobs.checko.refresh jobs.pipeline.run jobs.status.events jobs.worker.heartbeat; do
    $DC exec -T rabbitmq rabbitmqadmin -u "$RMQ_USER" -p "$RMQ_PASS" \
      declare queue name="$queue" durable=true arguments='{"x-dead-letter-exchange":"jobs.dlx"}' >/dev/null

    $DC exec -T rabbitmq rabbitmqadmin -u "$RMQ_USER" -p "$RMQ_PASS" \
      declare queue name="$queue.dlq" durable=true >/dev/null

    $DC exec -T rabbitmq rabbitmqadmin -u "$RMQ_USER" -p "$RMQ_PASS" \
      declare binding source=jobs.exchange destination_type=queue destination="$queue" routing_key="$queue" >/dev/null

    $DC exec -T rabbitmq rabbitmqadmin -u "$RMQ_USER" -p "$RMQ_PASS" \
      declare binding source=jobs.dlx destination_type=queue destination="$queue.dlq" routing_key="$queue" >/dev/null
  done

  ok "RabbitMQ topology is ready."
}

# ── build images ──────────────────────────────────────────────────────────────
if $REBUILD; then
  log "Rebuilding all images (--no-cache)…"
  $DC build --no-cache --parallel
else
  log "Building images (cached)…"
  $DC build --parallel
fi

# ── start services ────────────────────────────────────────────────────────────
log "Starting services…"
$DC up -d --remove-orphans

# ── wait helpers ──────────────────────────────────────────────────────────────
wait_for() {
  local name="$1"; local retries=90; shift
  log "Waiting for $name…"
  until "$@" >/dev/null 2>&1; do
    retries=$((retries - 1))
    [[ $retries -le 0 ]] && die "$name did not become ready in time. Run: $DC logs"
    sleep 2
  done
  ok "$name is ready."
}

# ── wait: postgres ────────────────────────────────────────────────────────────
wait_for "PostgreSQL" \
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T postgres pg_isready -U "$PG_USER" -d veles_ui

wait_for "RabbitMQ" \
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T rabbitmq rabbitmq-diagnostics -q check_running

ensure_rabbit_topology
start_autoscaler

_apply_ui_migrations() {
  local sql_files=(
    /sql-ui/001_init_schema.sql
    /sql-ui/003_analytics.sql
    /sql-ui/004_promocode_unlimited.sql
    /sql-ui/005_global_settings_and_project_price.sql
    /sql-ui/006_global_price_promo.sql
    /sql-ui/007_promo_timezone_and_timeless.sql
  )

  for sql_file in "${sql_files[@]}"; do
    $DC exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d veles_ui -f "$sql_file" >/dev/null
  done
}

log "Applying UI database migrations…"
_apply_ui_migrations
ok "UI schema is up to date."

# ── wait: backend API ─────────────────────────────────────────────────────────
wait_for "Backend API" \
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T api curl -sf http://localhost:8080/health

# ── wait: UI ──────────────────────────────────────────────────────────────────
log "Waiting for UI (may take ~30 s on first run)…"
UI_RETRIES=120
until curl -sf http://localhost:3000/login >/dev/null 2>&1; do
  UI_RETRIES=$((UI_RETRIES - 1))
  if [[ $UI_RETRIES -le 0 ]]; then
    warn "UI is taking longer than expected."
    warn "Check logs: $DC logs scan_ui"
    break
  fi
  sleep 2
done
if curl -sf http://localhost:3000/login >/dev/null 2>&1; then
  ok "UI is ready."
fi

# ── seed data ─────────────────────────────────────────────────────────────────
_load_seed() {
  local out
  out=$($DC exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d veles_ui -f /sql-ui/002_seed_test_data.sql \
    2>&1) || {
    echo "$out" | grep -v "^$" || true
    return 1
  }
  echo "$out" | grep -v "^$" || true
}

if $SEED; then
  log "Loading seed data…"
  _load_seed && ok "Seed data loaded." || warn "Seed data failed. See SQL output above."
else
  # Auto-seed on first run (tables empty)
  USER_COUNT=$($DC exec -T postgres \
    psql -U "$PG_USER" -d veles_ui -tAc "SELECT COUNT(*) FROM users" 2>/dev/null \
    | tr -d '[:space:]' || echo "0")
  if [[ "$USER_COUNT" == "0" ]]; then
    log "First run — loading demo seed data…"
    _load_seed && ok "Seed data loaded." || warn "Seed data failed (non-critical for startup)."
  fi
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  Veles Scan — all services running!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  🌐  UI             ${BLUE}http://localhost:3000${NC}"
echo -e "  🔒  Backend/API/DB/RabbitMQ/MinIO доступны только локально на сервере (127.0.0.1)"
echo -e "  🔌  API docs (from host): ${YELLOW}docker compose --project-name $PROJECT_NAME --env-file .env -f docker-compose.unified.yml exec -T api curl -s http://localhost:8080/docs${NC}"
echo -e "  🐰  RabbitMQ creds: ${RMQ_USER} / ${RMQ_PASS}"
echo -e "  📦  MinIO creds: ${MINIO_USER} / ${MINIO_PASS}"
echo ""
echo -e "  Demo login:        admin@velescan.test  /  admin123"
echo ""
echo -e "  Stop:    ${YELLOW}./start.sh --down${NC}"
echo -e "  Logs:    ${YELLOW}./start.sh --logs${NC}"
echo -e "  Rebuild: ${YELLOW}./start.sh --rebuild${NC}"
echo -e "  Reset:   ${YELLOW}./start.sh --reset${NC}"
echo ""
