#!/usr/bin/env bash
# ElectionTrace control — start | stop | restart | status | logs | index
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${ROOT}/app"
PID_FILE="${ROOT}/electiontrace.pid"
SUPERVISE_PID_FILE="${ROOT}/electiontrace.supervise.pid"
LOG_FILE="${ROOT}/electiontrace.log"
ENV_FILE="${ROOT}/.env"
DEFAULT_PORT=5200

usage() {
  cat <<EOF
Usage: $(basename "$0") {start|stop|restart|status|logs|index|help}
EOF
}

find_node() {
  if [[ -n "${ELECTIONTRACE_NODE:-}" && -x "${ELECTIONTRACE_NODE}" ]]; then
    echo "$ELECTIONTRACE_NODE"
    return
  fi
  for p in \
    /opt/GrokBuild/tools/node22-glibc217/bin/node \
    /opt/GrokBuild/tools/node/bin/node \
    "$(command -v node || true)"
  do
    if [[ -n "$p" && -x "$p" ]]; then
      echo "$p"
      return
    fi
  done
  echo "node not found (need Node 20+)" >&2
  return 1
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
  export PORT="${PORT:-$DEFAULT_PORT}"
  export HOST="${HOST:-0.0.0.0}"
  if [[ -z "${MEDIA_DIR:-}" ]]; then
    if compgen -G "${ROOT}/media/"*.geojson >/dev/null || compgen -G "${ROOT}/media/"*.geojson.gz >/dev/null; then
      export MEDIA_DIR="${ROOT}/media"
    elif compgen -G "${ROOT}/media/sample/"*.geojson >/dev/null; then
      export MEDIA_DIR="${ROOT}/media/sample"
    else
      export MEDIA_DIR="${ROOT}/media"
    fi
  fi
  export DATA_DIR="${DATA_DIR:-${ROOT}/data}"
  export APP_NAME="${APP_NAME:-ElectionTrace}"
  if [[ -f "${ROOT}/tls/server.key" && -f "${ROOT}/tls/server.crt" ]]; then
    export HTTPS_KEY="${HTTPS_KEY:-${ROOT}/tls/server.key}"
    export HTTPS_CERT="${HTTPS_CERT:-${ROOT}/tls/server.crt}"
  fi
}

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

cmd_status() {
  load_env
  if is_running; then
    echo "electiontrace RUNNING pid=$(cat "$PID_FILE") port=${PORT}"
  else
    echo "electiontrace STOPPED"
  fi
  echo "Media: ${MEDIA_DIR}"
  echo "Data:  ${DATA_DIR}"
}

cmd_stop() {
  if [[ -f "$SUPERVISE_PID_FILE" ]]; then
    local s
    s="$(cat "$SUPERVISE_PID_FILE" 2>/dev/null || true)"
    [[ -n "${s:-}" ]] && kill "$s" 2>/dev/null || true
    rm -f "$SUPERVISE_PID_FILE"
  fi
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    sleep 0.4
    if is_running; then
      kill -9 "$(cat "$PID_FILE")" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
  echo "Stopped"
}

cmd_start() {
  load_env
  if is_running; then
    echo "Already running pid=$(cat "$PID_FILE")"
    return 0
  fi
  mkdir -p "${ROOT}/data" "${ROOT}/media"
  : >>"$LOG_FILE"
  local node
  node="$(find_node)"
  nohup "$node" "$APP_DIR/server.mjs" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 0.5
  cmd_status
}

cmd_index() {
  load_env
  local node
  node="$(find_node)"
  "$node" "${ROOT}/scripts/index-media.mjs"
}

cmd_logs() { tail -n "${1:-80}" "$LOG_FILE"; }

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  index) cmd_index ;;
  logs) shift; cmd_logs "$@" ;;
  help|-h|--help) usage ;;
  *) usage; exit 2 ;;
esac
