#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="veles-scan"
COMPOSE_FILE=""
ENV_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    *)
      echo "[autoscaler] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$COMPOSE_FILE" || -z "$ENV_FILE" ]]; then
  echo "[autoscaler] --compose-file and --env-file are required" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[autoscaler] env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

AUTO_SCALING_ENABLED="${AUTO_SCALING_ENABLED:-true}"
AUTOSCALE_POLL_INTERVAL_SEC="${AUTOSCALE_POLL_INTERVAL_SEC:-5}"
AUTOSCALE_SCALE_UP_COOLDOWN_SEC="${AUTOSCALE_SCALE_UP_COOLDOWN_SEC:-5}"
AUTOSCALE_SCALE_DOWN_COOLDOWN_SEC="${AUTOSCALE_SCALE_DOWN_COOLDOWN_SEC:-90}"

AUTOSCALE_PIPELINE_MIN_REPLICAS="${AUTOSCALE_PIPELINE_MIN_REPLICAS:-1}"
AUTOSCALE_PIPELINE_MAX_REPLICAS="${AUTOSCALE_PIPELINE_MAX_REPLICAS:-6}"
AUTOSCALE_PIPELINE_TARGET_MESSAGES_PER_WORKER="${AUTOSCALE_PIPELINE_TARGET_MESSAGES_PER_WORKER:-1}"
AUTOSCALE_PIPELINE_CPU_PER_WORKER="${AUTOSCALE_PIPELINE_CPU_PER_WORKER:-1}"
AUTOSCALE_PIPELINE_MEMORY_MB_PER_WORKER="${AUTOSCALE_PIPELINE_MEMORY_MB_PER_WORKER:-2048}"
AUTOSCALE_HOST_RESERVED_CPU="${AUTOSCALE_HOST_RESERVED_CPU:-1}"
AUTOSCALE_HOST_RESERVED_MEMORY_MB="${AUTOSCALE_HOST_RESERVED_MEMORY_MB:-2048}"

PIPELINE_QUEUE_NAME="${AUTOSCALE_PIPELINE_QUEUE_NAME:-jobs.pipeline.run}"

RMQ_USER="${RABBITMQ_USER:-pipeline}"
RMQ_PASS="${RABBITMQ_PASSWORD:-pipeline}"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "[autoscaler] python3/python is required on host" >&2
  exit 1
fi

case "${AUTO_SCALING_ENABLED,,}" in
  1|true|yes|on) ;;
  *)
    echo "[autoscaler] disabled by AUTO_SCALING_ENABLED=$AUTO_SCALING_ENABLED"
    exit 0
    ;;
esac

DC=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

clamp() {
  local value="$1"
  local min="$2"
  local max="$3"
  if (( value < min )); then
    echo "$min"
    return
  fi
  if (( value > max )); then
    echo "$max"
    return
  fi
  echo "$value"
}

compute_desired() {
  local depth="$1"
  local min_repl="$2"
  local max_repl="$3"
  local target_per_worker="$4"

  if (( target_per_worker <= 0 )); then
    target_per_worker=1
  fi

  local workers_needed=0
  if (( depth > 0 )); then
    workers_needed=$(( (depth + target_per_worker - 1) / target_per_worker ))
  fi

  if (( workers_needed < min_repl )); then
    workers_needed="$min_repl"
  fi

  clamp "$workers_needed" "$min_repl" "$max_repl"
}

host_cpu_total() {
  local cpu_total
  if command -v nproc >/dev/null 2>&1; then
    cpu_total="$(nproc)"
  else
    cpu_total="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
  fi
  if [[ -z "$cpu_total" || ! "$cpu_total" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "0"
    return
  fi
  echo "$cpu_total"
}

host_memory_available_mb() {
  local available_kb
  available_kb="$(awk '/MemAvailable:/ { print $2; exit }' /proc/meminfo 2>/dev/null || echo 0)"
  if [[ -z "$available_kb" || ! "$available_kb" =~ ^[0-9]+$ ]]; then
    echo "0"
    return
  fi
  echo $(( available_kb / 1024 ))
}

pipeline_resource_scale_cap() {
  local current_pipeline="$1"
  local max_repl="$2"
  local cpu_total mem_available usable_mem allowed_by_mem resource_cap allowed_by_cpu

  cpu_total="$(host_cpu_total)"
  mem_available="$(host_memory_available_mb)"

  allowed_by_cpu="$max_repl"
  if awk "BEGIN { exit !(${AUTOSCALE_PIPELINE_CPU_PER_WORKER} > 0) }"; then
    allowed_by_cpu="$(awk -v total="$cpu_total" -v reserved="$AUTOSCALE_HOST_RESERVED_CPU" -v per_worker="$AUTOSCALE_PIPELINE_CPU_PER_WORKER" 'BEGIN {
      usable = total - reserved;
      if (usable < 0) usable = 0;
      if (per_worker <= 0) { print 0; exit }
      print int(usable / per_worker);
    }')"
  fi

  allowed_by_mem="$max_repl"
  if (( AUTOSCALE_PIPELINE_MEMORY_MB_PER_WORKER > 0 )); then
    usable_mem=$(( mem_available - AUTOSCALE_HOST_RESERVED_MEMORY_MB ))
    if (( usable_mem < 0 )); then
      usable_mem=0
    fi
    allowed_by_mem=$(( usable_mem / AUTOSCALE_PIPELINE_MEMORY_MB_PER_WORKER ))
  fi

  resource_cap="$allowed_by_cpu"
  if (( allowed_by_mem < resource_cap )); then
    resource_cap="$allowed_by_mem"
  fi

  if (( resource_cap < current_pipeline )); then
    resource_cap="$current_pipeline"
  fi

  clamp "$resource_cap" "$AUTOSCALE_PIPELINE_MIN_REPLICAS" "$max_repl"
}

running_replicas() {
  local service="$1"
  docker ps \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter "label=com.docker.compose.service=$service" \
    --filter "status=running" \
    -q \
    | wc -l \
    | tr -d ' '
}

read_queue_depths() {
  local queue_json
  if ! queue_json="$("${DC[@]}" exec -T rabbitmq rabbitmqadmin -u "$RMQ_USER" -p "$RMQ_PASS" -f raw_json -q list queues name messages 2>/dev/null)"; then
    echo "-1"
    return
  fi

  "$PYTHON_BIN" - "$PIPELINE_QUEUE_NAME" "$queue_json" <<'PY'
import json
import sys

pipeline_name = sys.argv[1]
raw_json = sys.argv[2]

try:
    payload = json.loads(raw_json)
except Exception:
    print("-1")
    raise SystemExit(0)

queues = payload if isinstance(payload, list) else payload.get("queues", [])
depth = {pipeline_name: 0}

for row in queues:
    name = row.get("name")
    if name in depth:
        try:
            depth[name] = int(row.get("messages", 0) or 0)
        except Exception:
            depth[name] = 0

print(depth[pipeline_name])
PY
}

last_pipeline_up=0
last_pipeline_down=0

echo "[autoscaler] started: project=$PROJECT_NAME poll=${AUTOSCALE_POLL_INTERVAL_SEC}s"

while true; do
  now="$(date +%s)"

  read -r pipeline_depth < <(read_queue_depths)
  if (( pipeline_depth < 0 )); then
    echo "[autoscaler] rabbitmq not ready, retrying..."
    sleep "$AUTOSCALE_POLL_INTERVAL_SEC"
    continue
  fi

  current_pipeline="$(running_replicas pipeline_worker)"
  current_checko="$(running_replicas checko_worker)"

  desired_pipeline="$(compute_desired "$pipeline_depth" "$AUTOSCALE_PIPELINE_MIN_REPLICAS" "$AUTOSCALE_PIPELINE_MAX_REPLICAS" "$AUTOSCALE_PIPELINE_TARGET_MESSAGES_PER_WORKER")"
  resource_pipeline_cap="$(pipeline_resource_scale_cap "$current_pipeline" "$AUTOSCALE_PIPELINE_MAX_REPLICAS")"
  if (( desired_pipeline > resource_pipeline_cap )); then
    desired_pipeline="$resource_pipeline_cap"
  fi

  target_pipeline="$current_pipeline"
  target_checko="1"

  if (( desired_pipeline > current_pipeline )); then
    if (( now - last_pipeline_up >= AUTOSCALE_SCALE_UP_COOLDOWN_SEC )); then
      target_pipeline="$desired_pipeline"
      last_pipeline_up="$now"
    fi
  elif (( desired_pipeline < current_pipeline )); then
    if (( now - last_pipeline_down >= AUTOSCALE_SCALE_DOWN_COOLDOWN_SEC )); then
      target_pipeline="$desired_pipeline"
      last_pipeline_down="$now"
    fi
  fi

  if (( target_pipeline != current_pipeline || target_checko != current_checko )); then
    echo "[autoscaler] scale pipeline: ${current_pipeline}->${target_pipeline} (q=${pipeline_depth}, resource_cap=${resource_pipeline_cap}), checko: ${current_checko}->${target_checko}"
    "${DC[@]}" up -d --no-deps \
      --scale "pipeline_worker=$target_pipeline" \
      --scale "checko_worker=$target_checko" \
      pipeline_worker checko_worker >/dev/null
  fi

  sleep "$AUTOSCALE_POLL_INTERVAL_SEC"
done
