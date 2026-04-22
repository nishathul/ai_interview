#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

stop_from_pid_file() {
  local pid_file="$1"
  local name="$2"
  if [[ ! -f "${pid_file}" ]]; then
    echo "${name} not running"
    return
  fi

  local pid
  pid="$(cat "${pid_file}")"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
    echo "Stopped ${name} (pid ${pid})"
  else
    echo "${name} already stopped"
  fi
  rm -f "${pid_file}"
}

stop_from_pid_file "${BACKEND_PID_FILE}" "backend"
stop_from_pid_file "${FRONTEND_PID_FILE}" "frontend"

echo "Stopping Janus container..."
docker compose stop janus >/dev/null 2>&1 || true
echo "Done."
