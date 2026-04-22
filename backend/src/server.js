import "dotenv/config";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { customAlphabet } from "nanoid";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const recordingsDir = path.join(repoRoot, "infra", "recordings");
const storageDir = path.join(repoRoot, "storage");
const dataDir = path.join(__dirname, "..", "data");
const publicDir = path.join(__dirname, "..", "public");
const sessionsFile = path.join(dataDir, "sessions.json");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/storage", express.static(storageDir));
app.use("/raw-recordings", express.static(recordingsDir));
app.use("/admin", express.static(publicDir));

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "local-dev-secret";
const JANUS_HTTP_URL = process.env.JANUS_HTTP_URL || "http://localhost:8088/janus";
const JANUS_WS_URL = process.env.JANUS_WS_URL || "ws://localhost:8188";
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:5173";

async function ensureDirectories() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(recordingsDir, { recursive: true });
  await fs.mkdir(storageDir, { recursive: true });

  if (!existsSync(sessionsFile)) {
    await fs.writeFile(sessionsFile, "[]", "utf8");
  }
}

async function readSessions() {
  const raw = await fs.readFile(sessionsFile, "utf8");
  return JSON.parse(raw);
}

async function writeSessions(sessions) {
  await fs.writeFile(sessionsFile, JSON.stringify(sessions, null, 2), "utf8");
}

async function janusRequest(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Janus request failed: ${response.status}`);
  }

  return response.json();
}

async function createJanusRoom(roomId) {
  const transactionPrefix = nanoid();
  const createSession = await janusRequest(JANUS_HTTP_URL, {
    janus: "create",
    transaction: `${transactionPrefix}-create`
  });

  const janusSessionId = createSession?.data?.id;
  if (!janusSessionId) {
    throw new Error("Unable to create Janus session.");
  }

  try {
    const attach = await janusRequest(`${JANUS_HTTP_URL}/${janusSessionId}`, {
      janus: "attach",
      plugin: "janus.plugin.videoroom",
      transaction: `${transactionPrefix}-attach`
    });

    const janusHandleId = attach?.data?.id;
    if (!janusHandleId) {
      throw new Error("Unable to attach VideoRoom plugin.");
    }

    const createRoomResponse = await janusRequest(
      `${JANUS_HTTP_URL}/${janusSessionId}/${janusHandleId}`,
      {
        janus: "message",
        body: {
          request: "create",
          room: roomId,
          permanent: false,
          publishers: 1,
          bitrate: 512000,
          bitrate_cap: true,
          fir_freq: 2,
          videocodec: "vp8",
          record: true,
          rec_dir: "/recordings"
        },
        transaction: `${transactionPrefix}-room`
      }
    );

    const status = createRoomResponse?.plugindata?.data?.videoroom;
    if (status !== "created" && createRoomResponse?.plugindata?.data?.error_code !== 427) {
      throw new Error("Janus room create failed.");
    }
  } finally {
    await janusRequest(`${JANUS_HTTP_URL}/${janusSessionId}`, {
      janus: "destroy",
      transaction: `${transactionPrefix}-destroy`
    }).catch(() => null);
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health/details", async (_req, res) => {
  const checked_at = new Date().toISOString();
  try {
    const createSession = await janusRequest(JANUS_HTTP_URL, {
      janus: "create",
      transaction: `health-${nanoid()}`
    });

    const janusSessionId = createSession?.data?.id;
    if (!janusSessionId) {
      return res.status(200).json({
        backend_ok: true,
        janus_ok: false,
        janus_http_url: JANUS_HTTP_URL,
        checked_at,
        error: "Janus returned no session id"
      });
    }

    await janusRequest(`${JANUS_HTTP_URL}/${janusSessionId}`, {
      janus: "destroy",
      transaction: `health-destroy-${nanoid()}`
    }).catch(() => null);

    return res.status(200).json({
      backend_ok: true,
      janus_ok: true,
      janus_http_url: JANUS_HTTP_URL,
      checked_at
    });
  } catch (error) {
    return res.status(200).json({
      backend_ok: true,
      janus_ok: false,
      janus_http_url: JANUS_HTTP_URL,
      checked_at,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/session/create", async (req, res) => {
  try {
    const candidateId = String(req.body?.candidate_id || nanoid());
    const roomId = Number(`9${Math.floor(Math.random() * 899999) + 100000}`);
    const sessionId = nanoid();

    await createJanusRoom(roomId);

    const token = jwt.sign(
      {
        session_id: sessionId,
        room_id: roomId,
        candidate_id: candidateId
      },
      JWT_SECRET,
      { expiresIn: "6h" }
    );

    const startLinkParams = new URLSearchParams({
      mode: "attend",
      session_id: sessionId,
      room_id: String(roomId),
      token,
      candidate_id: candidateId,
      janus_ws_url: JANUS_WS_URL,
      janus_http_url: JANUS_HTTP_URL
    });
    const start_link = `${FRONTEND_BASE_URL}/?${startLinkParams.toString()}`;

    const sessions = await readSessions();
    sessions.push({
      session_id: sessionId,
      room_id: roomId,
      candidate_id: candidateId,
      status: "created",
      created_at: new Date().toISOString()
    });
    await writeSessions(sessions);

    res.json({
      session_id: sessionId,
      room_id: roomId,
      token,
      janus_ws_url: JANUS_WS_URL,
      janus_http_url: JANUS_HTTP_URL,
      start_link
    });
  } catch (error) {
    res.status(500).json({
      error: "failed_to_create_session",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/session/:sessionId/end", async (req, res) => {
  const { sessionId } = req.params;
  const durationSeconds = Number(req.body?.duration_seconds || 0);

  const sessions = await readSessions();
  const target = sessions.find((item) => item.session_id === sessionId);
  if (!target) {
    return res.status(404).json({ error: "session_not_found" });
  }

  target.status = "ended";
  target.duration_seconds = durationSeconds;
  target.ended_at = new Date().toISOString();
  await writeSessions(sessions);

  return res.json({ ok: true });
});

app.get("/sessions", async (_req, res) => {
  const sessions = await readSessions();
  res.json({ sessions });
});

app.post("/recordings/process", async (req, res) => {
  const sessionId = req.body?.session_id ? String(req.body.session_id) : "";
  const scriptPath = path.join(repoRoot, "scripts", "convert-recordings.sh");
  const args = sessionId ? [sessionId] : [];

  try {
    const { stdout, stderr } = await execFileAsync(scriptPath, args, {
      cwd: repoRoot
    });
    res.json({ ok: true, stdout, stderr });
  } catch (error) {
    const err = error;
    res.status(500).json({
      error: "processing_failed",
      details: error instanceof Error ? error.message : String(error),
      stdout: err?.stdout || "",
      stderr: err?.stderr || ""
    });
  }
});

app.post("/recordings/process/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const scriptPath = path.join(repoRoot, "scripts", "convert-recordings.sh");

  try {
    const { stdout, stderr } = await execFileAsync(scriptPath, [String(sessionId)], {
      cwd: repoRoot
    });
    res.json({ ok: true, stdout, stderr, session_id: sessionId });
  } catch (error) {
    const err = error;
    res.status(500).json({
      error: "processing_failed",
      details: error instanceof Error ? error.message : String(error),
      stdout: err?.stdout || "",
      stderr: err?.stderr || "",
      session_id: sessionId
    });
  }
});

app.get("/recordings", async (_req, res) => {
  const entries = await fs.readdir(storageDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".webm") || name.endsWith(".mp4"));

  res.json({
    recordings: files.map((name) => ({
      name,
      url: `/storage/${name}`
    }))
  });
});

app.get("/interviews", async (_req, res) => {
  const sessions = await readSessions();
  const rawEntries = await fs.readdir(recordingsDir, { withFileTypes: true });
  const convertedEntries = await fs.readdir(storageDir, { withFileTypes: true });

  const rawFiles = rawEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".mjr"));

  const convertedFiles = convertedEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".webm") || name.endsWith(".mp4"));

  const interviews = sessions
    .sort((a, b) => new Date(b.ended_at || b.created_at) - new Date(a.ended_at || a.created_at))
    .map((session) => {
      const rawForSession = rawFiles.filter((file) => file.includes(session.session_id));
      const convertedForSession = convertedFiles.filter((file) =>
        file.includes(session.session_id)
      );

      return {
        ...session,
        raw_recordings: rawForSession.map((name) => ({
          name,
          url: `/raw-recordings/${name}`
        })),
        converted_recordings: convertedForSession.map((name) => ({
          name,
          url: `/storage/${name}`
        }))
      };
    });

  res.json({ interviews });
});

app.delete("/interviews/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const sessions = await readSessions();
  const target = sessions.find((item) => item.session_id === sessionId);

  if (!target) {
    return res.status(404).json({ error: "session_not_found" });
  }

  const remainingSessions = sessions.filter((item) => item.session_id !== sessionId);
  await writeSessions(remainingSessions);

  const [rawEntries, convertedEntries] = await Promise.all([
    fs.readdir(recordingsDir, { withFileTypes: true }),
    fs.readdir(storageDir, { withFileTypes: true })
  ]);

  const rawMatches = rawEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.includes(sessionId));

  const convertedMatches = convertedEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.includes(sessionId));

  await Promise.all([
    ...rawMatches.map((name) => fs.unlink(path.join(recordingsDir, name)).catch(() => null)),
    ...convertedMatches.map((name) => fs.unlink(path.join(storageDir, name)).catch(() => null))
  ]);

  return res.json({
    ok: true,
    session_id: sessionId,
    deleted_raw_files: rawMatches,
    deleted_converted_files: convertedMatches
  });
});

await ensureDirectories();
app.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});
