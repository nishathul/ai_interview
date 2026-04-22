#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

mkdir -p "${RUN_DIR}"

is_running() {
  local pid_file="$1"
  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "${pid_file}")"
  if [[ -z "${pid}" ]]; then
    return 1
  fi
  kill -0 "${pid}" >/dev/null 2>&1
}

echo "[1/3] Starting Janus (docker compose)..."
docker compose up -d janus

echo "[2/3] Starting backend..."
if is_running "${BACKEND_PID_FILE}"; then
  echo "Backend already running (pid $(cat "${BACKEND_PID_FILE}"))"
else
  nohup bash -lc "cd \"${ROOT_DIR}/backend\" && npm run dev" >"${RUN_DIR}/backend.log" 2>&1 &
  echo $! >"${BACKEND_PID_FILE}"
  echo "Backend started (pid $(cat "${BACKEND_PID_FILE}"))"
fi

echo "[3/3] Starting frontend..."
if is_running "${FRONTEND_PID_FILE}"; then
  echo "Frontend already running (pid $(cat "${FRONTEND_PID_FILE}"))"
else
  nohup bash -lc "cd \"${ROOT_DIR}/frontend\" && npm run dev" >"${RUN_DIR}/frontend.log" 2>&1 &
  echo $! >"${FRONTEND_PID_FILE}"
  echo "Frontend started (pid $(cat "${FRONTEND_PID_FILE}"))"
fi

cat <<EOF

Development stack started.
- Frontend: http://localhost:5173
- Backend:  http://localhost:4000

Logs:
- ${RUN_DIR}/frontend.log
- ${RUN_DIR}/backend.log
EOF
