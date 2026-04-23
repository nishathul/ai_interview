# Interview Stream — DevOps installation and operations

This document is for teams deploying or running the **Interview Stream** MVP locally or on a shared dev host. For architecture and product behavior, see `README.md` and `TECHNICAL_IMPLEMENTATION.md`.

---

## 1. What runs

| Component | Role | Typical dev binding |
|-----------|------|---------------------|
| **Janus** (Docker) | WebRTC SFU, server-side `.mjr` recording | HTTP `8088`, WebSocket `8188`, RTP **UDP 10000–10200** |
| **Backend** (Node) | Sessions, JWT, Janus room API, file APIs, conversion triggers | `http://0.0.0.0:4000` |
| **Frontend** (Vite) | React UI | `http://localhost:5173` |

The one-command script starts Janus plus backend and frontend in the background and writes logs under `.run/`.

---

## 2. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Linux** (or macOS with Docker) | UDP port range mapping is easiest on Linux. |
| **Node.js 20+** | For backend and frontend. |
| **npm 10+** | Recommended. |
| **Docker Engine + Docker Compose v2** | Required for Janus; conversion script uses `docker compose exec`. |
| **Bash** | `scripts/dev-up.sh` and `scripts/dev-down.sh` use `bash`. |
| **ffmpeg** (optional) | Host `ffmpeg` speeds up merge to MP4; otherwise the conversion script can use a Docker ffmpeg image (see `README.md`). |

Ensure nothing else binds to **4000**, **5173**, **8088**, **8188**, and **UDP 10000–10200** on the host where Janus is published.

---

## 3. First-time installation

From the repository root:

```bash
git clone <repository-url> interview_stream
cd interview_stream
```

### 3.1 Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` for your environment (see section 4).

### 3.2 Frontend

```bash
cd ../frontend
npm install
cd ..
```

### 3.3 Root helpers (optional)

```bash
npm install
```

Root `package.json` only defines `npm start` / `npm run stop`; installing at root is optional but keeps tooling consistent.

### 3.4 Data directories

The app expects these paths (created automatically where noted):

| Path | Purpose |
|------|---------|
| `infra/recordings/` | Bind-mounted into Janus as `/recordings` (raw `.mjr`). |
| `storage/` | Converted assets served by the backend. |
| `backend/data/` | Created at runtime; holds `sessions.json` (session metadata). |

Ensure the runtime user can read/write these directories.

---

## 4. Configuration (`backend/.env`)

Copy from `backend/.env.example` and set at minimum:

| Variable | Description |
|----------|-------------|
| `PORT` | API port (default `4000`). |
| `JWT_SECRET` | **Change in any shared or non-local environment.** |
| `JANUS_HTTP_URL` | Janus REST base (default `http://localhost:8088/janus`). |
| `JANUS_WS_URL` | Janus WebSocket URL exposed to browsers (default `ws://localhost:8188`). If users reach the UI via a hostname, this often must match what the **browser** can resolve (e.g. `ws://dev-host:8188`). |
| `FRONTEND_BASE_URL` | Used when building share/start links (default `http://localhost:5173`). Set to the URL users actually open. |

**Firewall / NAT:** WebRTC may need **UDP 10000–10200** open toward the Janus host. For strict corporate networks, plan a **TURN** server (not included in this MVP).

---

## 5. Starting the stack (development)

From the **repository root**:

```bash
npm start
```

Equivalent:

```bash
./scripts/dev-up.sh
```

This will:

1. `docker compose up -d janus` — start the Janus container (`canyan/janus-gateway`).
2. Start `npm run dev` in `backend/` under `nohup`.
3. Start `npm run dev` in `frontend/` under `nohup`.

**URLs**

- Frontend: `http://localhost:5173` (or your configured host).
- Backend API: `http://localhost:4000`.

**Logs**

- `.run/backend.log`
- `.run/frontend.log`
- Docker: `docker compose logs -f janus`

**PID files** (used by `dev-down`): `.run/backend.pid`, `.run/frontend.pid`.

---

## 6. Stopping the stack

```bash
npm run stop
```

Or:

```bash
./scripts/dev-down.sh
```

This stops the Node processes recorded in `.run/*.pid` and runs `docker compose stop janus`.

To remove the Janus container entirely:

```bash
docker compose down
```

---

## 7. Health checks and smoke tests

| Check | Command / URL |
|--------|----------------|
| Backend liveness | `curl -sS http://localhost:4000/health` |
| Backend + Janus detail | `curl -sS http://localhost:4000/health/details` |
| Janus HTTP | `curl -sS -o /dev/null -w "%{http_code}" http://localhost:8088/janus` (expect non-5xx; Janus may respond with session negotiation errors without a full POST—use `/health/details` for integrated checks). |
| Frontend | Open `http://localhost:5173` in a browser. |

---

## 8. Recordings and conversion

- Raw recordings land under `infra/recordings/` (and inside the container under `/recordings`).
- After interviews end, operators can convert and merge via:

```bash
./scripts/convert-recordings.sh
```

Or target one session (if supported by your checkout):

```bash
./scripts/convert-recordings.sh <session_id>
```

HTTP alternative:

```bash
curl -X POST http://localhost:4000/recordings/process
```

Converted output is under `storage/` and exposed by the API and static routes (see `README.md`).

**Dependencies:** Docker must be running with the `janus` service up; host `ffmpeg` is optional depending on merge path.

---

## 9. Operational notes (MVP)

- **Persistence:** Back up `backend/data/sessions.json`, `infra/recordings/`, and `storage/` if interviews must survive host rebuilds.
- **Secrets:** Never commit `.env`; rotate `JWT_SECRET` if leaked.
- **Image tags:** `docker-compose.yml` uses `canyan/janus-gateway:latest`. For reproducible deploys, pin a specific image digest or version tag.
- **Production:** This repo targets **local / dev** workflows (`nohup`, Vite dev server). Production would typically use a reverse proxy, TLS, pinned Janus config, process manager or containers for Node, and a build of the frontend static assets—not covered in detail here.

---

## 10. Troubleshooting

| Symptom | Things to verify |
|---------|-------------------|
| `failed_to_create_session` / room errors | Janus up: `docker compose ps`. Check `http://localhost:4000/health/details`. |
| No media / ICE failures | UDP **10000–10200** reachable; consider TURN for locked-down clients. |
| Frontend cannot reach API | CORS and correct API base URL in frontend config (Vite env if used). |
| Empty dashboard / missing interviews | Session end must complete; check backend logs and `backend/data/sessions.json`. |
| Conversion fails | `docker compose exec janus` available; see `.run/backend.log` and script stderr; ensure `ffmpeg` or Docker ffmpeg fallback per `README.md`. |
| Port already in use | Change `PORT` / Vite port or free the conflicting process. |

---

## 11. Quick reference

```bash
# Install (once)
(cd backend && npm install && cp .env.example .env)
(cd frontend && npm install)

# Run
npm start

# Stop
npm run stop

# Logs
tail -f .run/backend.log .run/frontend.log
docker compose logs -f janus
```

For API and feature overview, see `README.md` section **Main API endpoints**.
