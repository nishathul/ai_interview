# Interview Recording MVP (Local)

This project is a local MVP for candidate interview recording with:

- `frontend/` React candidate app (camera + mic capture, publish to Janus)
- `backend/` Node.js control API (session creation, Janus room provisioning, processing hooks)
- `docker-compose.yml` Janus WebRTC media server (VideoRoom + server-side recording)
- `infra/recordings/` raw Janus `.mjr` output
- `storage/` processed `.webm` files for playback/download

Technical design details are documented in:

- `TECHNICAL_IMPLEMENTATION.md`

## Requirements

- Node.js `20+`
- npm `10+` (recommended)
- Docker + Docker Compose
- `ffmpeg` (optional on host; script falls back to docker image `jrottenberg/ffmpeg:6.0-alpine`)

## Architecture

Candidate browser (React) -> Janus WebRTC VideoRoom -> `.mjr` recordings -> conversion -> `storage/` -> admin playback

## 1) Start Janus

From repo root:

```bash
docker compose up -d
```

Janus endpoints used by this MVP:

- HTTP API: `http://localhost:8088/janus`
- WebSocket API: `ws://localhost:8188`

## 2) Start backend API

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

API URL: `http://localhost:4000`

## 3) Start candidate frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

### Optional one-command startup

From repo root:

```bash
./scripts/dev-up.sh
```

To stop:

```bash
./scripts/dev-down.sh
```

Open `http://localhost:5173` and run:

1. Create Session
2. Start Interview (camera/mic permission prompt)
3. End Interview

The frontend publishes to Janus with `record: true`, so recording is server-side.

## 4) Process recordings

After interview end:

```bash
./scripts/convert-recordings.sh
```

Or via API:

```bash
curl -X POST http://localhost:4000/recordings/process
```

Converted files are copied to `storage/`.

## 5) Unified UI (candidate + admin)

Open:

- `http://localhost:5173`

You can:

- create and run interview sessions
- generate/share interview start links
- monitor backend + Janus health in-app
- filter interviews by candidate, status, and date
- process all recordings or one interview at a time
- play/download raw and converted files from interview history

Interview links open in attendee mode (`mode=attend`) that hides admin/history and shows only the interview controls.
Attendee mode includes a live performance monitor (network state, ICE/WebRTC state, bitrate, fps, packet loss, slow-link count).

## Main API endpoints

- `POST /session/create` -> `{ session_id, room_id, token, janus_ws_url, janus_http_url, start_link }`
- `POST /session/:sessionId/end`
- `GET /sessions`
- `GET /health/details`
- `POST /recordings/process`
- `POST /recordings/process/:sessionId` (convert a specific interview)
- `GET /recordings`
- `GET /interviews` (ended sessions + matched `.mjr` + converted files)
- `DELETE /interviews/:sessionId` (delete interview metadata + local files)

## Notes / limitations (MVP)

- Storage is local filesystem only (`storage/`)
- TURN server is not configured (add Coturn for strict/firewalled networks)
- Recording conversion depends on `janus-pp-rec` in Janus container
- Authentication is minimal (JWT issued but not yet enforced at publish time)
- Video stability is tuned for local reliability (`640x360`, capped bitrate, `fir_freq=2` for periodic keyframes)
