import { useEffect, useMemo, useRef, useState } from "react";
import adapter from "webrtc-adapter";
import Janus from "janus-gateway";
import SessionControls from "./components/SessionControls";
import StatusPanel from "./components/StatusPanel";
import HealthPanel from "./components/HealthPanel";
import AdminPanel from "./components/AdminPanel";
import InterviewHistory from "./components/InterviewHistory";
import AttendPerformancePanel from "./components/AttendPerformancePanel";

const API_BASE = "http://localhost:4000";

if (typeof window !== "undefined" && !window.adapter) {
  window.adapter = adapter;
}

function App() {
  const videoRef = useRef(null);
  const janusRef = useRef(null);
  const pluginRef = useRef(null);
  const streamRef = useRef(null);
  const startedAtRef = useRef(0);
  const janusInitRef = useRef(false);
  const statsTimerRef = useRef(null);
  const endPersistedRef = useRef(false);
  const currentSessionRef = useRef(null);
  const currentIsLiveRef = useRef(false);
  const lastOutboundRef = useRef({
    bytesSent: null,
    timestamp: null
  });

  const [candidateId, setCandidateId] = useState("");
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("Idle");
  const [busy, setBusy] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [adminStatus, setAdminStatus] = useState("Idle");
  const [adminBusy, setAdminBusy] = useState(false);
  const [interviews, setInterviews] = useState([]);
  const [candidateFilter, setCandidateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [isAttendMode, setIsAttendMode] = useState(false);
  const [health, setHealth] = useState({
    backend_ok: false,
    janus_ok: false,
    checked_at: null,
    error: ""
  });
  const [performanceMetrics, setPerformanceMetrics] = useState({
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    effectiveType: "unknown",
    rttMs: null,
    downlinkMbps: null,
    webrtcState: "idle",
    iceState: "new",
    connectionState: "new",
    audioActive: false,
    videoActive: false,
    bitrateKbps: null,
    fps: null,
    packetsLost: 0,
    slowLinkCount: 0,
    updatedAt: null
  });
  const interviewsRefreshRef = useRef(null);

  const canStart = useMemo(() => Boolean(session?.room_id), [session]);
  const filteredInterviews = useMemo(() => {
    const candidateTerm = candidateFilter.trim().toLowerCase();
    const fromDate = fromDateFilter ? new Date(`${fromDateFilter}T00:00:00`) : null;
    const toDate = toDateFilter ? new Date(`${toDateFilter}T23:59:59`) : null;

    return interviews.filter((item) => {
      const candidate = String(item.candidate_id || "").toLowerCase();
      const interviewStatus = String(item.status || "");
      const endedAt = item.ended_at ? new Date(item.ended_at) : null;

      if (candidateTerm && !candidate.includes(candidateTerm)) {
        return false;
      }
      if (statusFilter !== "all" && interviewStatus !== statusFilter) {
        return false;
      }
      if (fromDate && (!endedAt || endedAt < fromDate)) {
        return false;
      }
      if (toDate && (!endedAt || endedAt > toDate)) {
        return false;
      }
      return true;
    });
  }, [candidateFilter, fromDateFilter, interviews, statusFilter, toDateFilter]);

  const mediaUrl = (url) => `${API_BASE}${url}`;

  const persistInterviewEnd = async ({ useBeacon = false } = {}) => {
    const activeSession = currentSessionRef.current;
    if (!activeSession?.session_id || endPersistedRef.current) {
      return true;
    }

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const payload = JSON.stringify({ duration_seconds: durationSeconds });
    const url = `${API_BASE}/session/${activeSession.session_id}/end`;

    if (useBeacon && navigator.sendBeacon) {
      const sent = navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      if (sent) {
        endPersistedRef.current = true;
      }
      return sent;
    }

    const endRes = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload
    });
    const endData = await endRes.json().catch(() => ({}));
    if (!endRes.ok) {
      throw new Error(endData?.error || "Failed to save interview end status");
    }
    endPersistedRef.current = true;
    return true;
  };

  const updateNetworkMetrics = () => {
    const connection =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    setPerformanceMetrics((prev) => ({
      ...prev,
      online: navigator.onLine,
      effectiveType: connection?.effectiveType || "unknown",
      rttMs: Number.isFinite(connection?.rtt) ? connection.rtt : null,
      downlinkMbps: Number.isFinite(connection?.downlink) ? connection.downlink : null,
      updatedAt: new Date().toLocaleTimeString()
    }));
  };

  const refreshPeerStats = async () => {
    const peerConnection = pluginRef.current?.webrtcStuff?.pc;
    if (!peerConnection?.getStats) {
      return;
    }

    try {
      const stats = await peerConnection.getStats();
      let bitrateKbps = null;
      let fps = null;
      let packetsLost = null;

      stats.forEach((report) => {
        if (report.type === "outbound-rtp" && report.kind === "video") {
          if (lastOutboundRef.current.bytesSent != null && lastOutboundRef.current.timestamp != null) {
            const bytesDelta = report.bytesSent - lastOutboundRef.current.bytesSent;
            const timeDeltaMs = report.timestamp - lastOutboundRef.current.timestamp;
            if (timeDeltaMs > 0) {
              bitrateKbps = Math.round((bytesDelta * 8) / timeDeltaMs);
            }
          }
          lastOutboundRef.current = {
            bytesSent: report.bytesSent,
            timestamp: report.timestamp
          };
          if (Number.isFinite(report.framesPerSecond)) {
            fps = Math.round(report.framesPerSecond);
          }
          if (Number.isFinite(report.packetsLost)) {
            packetsLost = report.packetsLost;
          }
        }
      });

      setPerformanceMetrics((prev) => ({
        ...prev,
        bitrateKbps: bitrateKbps ?? prev.bitrateKbps,
        fps: fps ?? prev.fps,
        packetsLost: packetsLost ?? prev.packetsLost,
        updatedAt: new Date().toLocaleTimeString()
      }));
    } catch (_error) {
      // Ignore transient stats read failures.
    }
  };

  const attachPreviewStream = async (mediaStream) => {
    if (!videoRef.current) {
      throw new Error("Preview element is not ready.");
    }
    videoRef.current.srcObject = mediaStream;
    videoRef.current.muted = true;
    videoRef.current.playsInline = true;
    await videoRef.current.play().catch(() => null);
    if (!mediaStream.getVideoTracks().length) {
      throw new Error("Camera stream has no video track.");
    }
  };

  const loadInterviews = async () => {
    try {
      setAdminStatus("Loading interviews...");
      const res = await fetch(`${API_BASE}/interviews`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.details || data?.error || "Unable to load interviews");
      }
      setInterviews(data.interviews || []);
      setAdminStatus("Interview list updated.");
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshHealth = async () => {
    try {
      const response = await fetch(`${API_BASE}/health/details`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Health check failed");
      }
      setHealth({
        backend_ok: Boolean(payload.backend_ok),
        janus_ok: Boolean(payload.janus_ok),
        checked_at: payload.checked_at,
        error: payload.error || "",
        janus_http_url: payload.janus_http_url
      });
    } catch (error) {
      setHealth({
        backend_ok: false,
        janus_ok: false,
        checked_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const processAllRecordings = async () => {
    try {
      setAdminBusy(true);
      setAdminStatus("Processing all .mjr files...");
      const res = await fetch(`${API_BASE}/recordings/process`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.details || data?.error || "Failed to process recordings");
      }
      setAdminStatus(data.stdout || "All recordings processed.");
      await loadInterviews();
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAdminBusy(false);
    }
  };

  const processSingleInterview = async (sessionId) => {
    try {
      setAdminBusy(true);
      setAdminStatus(`Processing .mjr for session ${sessionId} ...`);
      const res = await fetch(`${API_BASE}/recordings/process/${sessionId}`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.details || data?.error || "Failed to process interview");
      }
      setAdminStatus(data.stdout || `Processed ${sessionId}`);
      await loadInterviews();
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAdminBusy(false);
    }
  };

  const deleteInterview = async (sessionId) => {
    if (!window.confirm(`Delete interview ${sessionId}? This removes metadata and local files.`)) {
      return;
    }

    if (isLive && session?.session_id === sessionId) {
      setAdminStatus("Stop the live interview before deleting it.");
      return;
    }

    try {
      setAdminBusy(true);
      setAdminStatus(`Deleting interview ${sessionId} ...`);
      const res = await fetch(`${API_BASE}/interviews/${sessionId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.details || data?.error || "Failed to delete interview");
      }
      if (session?.session_id === sessionId) {
        setSession(null);
        setIsLive(false);
      }
      setAdminStatus(`Deleted ${sessionId}`);
      await loadInterviews();
    } catch (error) {
      setAdminStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAdminBusy(false);
    }
  };

  useEffect(() => {
    loadInterviews().catch(() => null);
    refreshHealth().catch(() => null);
    updateNetworkMetrics();
  }, []);

  useEffect(() => {
    currentSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    currentIsLiveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    const flushOnExit = () => {
      if (currentIsLiveRef.current && currentSessionRef.current?.session_id && !endPersistedRef.current) {
        persistInterviewEnd({ useBeacon: true }).catch(() => null);
      }
    };

    window.addEventListener("beforeunload", flushOnExit);
    window.addEventListener("pagehide", flushOnExit);
    return () => {
      window.removeEventListener("beforeunload", flushOnExit);
      window.removeEventListener("pagehide", flushOnExit);
    };
  }, []);

  useEffect(() => {
    if (isAttendMode) {
      if (interviewsRefreshRef.current) {
        clearInterval(interviewsRefreshRef.current);
        interviewsRefreshRef.current = null;
      }
      return undefined;
    }

    interviewsRefreshRef.current = setInterval(() => {
      loadInterviews().catch(() => null);
    }, 10000);

    return () => {
      if (interviewsRefreshRef.current) {
        clearInterval(interviewsRefreshRef.current);
        interviewsRefreshRef.current = null;
      }
    };
  }, [isAttendMode]);

  useEffect(() => {
    const connection =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const handleOnline = () => updateNetworkMetrics();
    const handleOffline = () => updateNetworkMetrics();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    connection?.addEventListener?.("change", updateNetworkMetrics);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      connection?.removeEventListener?.("change", updateNetworkMetrics);
    };
  }, []);

  useEffect(() => {
    if (!isLive) {
      if (statsTimerRef.current) {
        clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      return undefined;
    }

    statsTimerRef.current = setInterval(() => {
      refreshPeerStats().catch(() => null);
    }, 3000);

    return () => {
      if (statsTimerRef.current) {
        clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
    };
  }, [isLive]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const linkedSessionId = params.get("session_id");
    const linkedRoomId = params.get("room_id");
    const linkedToken = params.get("token");
    setIsAttendMode(mode === "attend");

    if (!linkedSessionId || !linkedRoomId || !linkedToken) {
      return;
    }

    const linkedSession = {
      session_id: linkedSessionId,
      room_id: Number(linkedRoomId),
      token: linkedToken,
      candidate_id: params.get("candidate_id") || "",
      janus_ws_url: params.get("janus_ws_url") || "ws://localhost:8188",
      janus_http_url: params.get("janus_http_url") || "http://localhost:8088/janus",
      start_link: window.location.href
    };

    setSession(linkedSession);
    if (linkedSession.candidate_id) {
      setCandidateId(linkedSession.candidate_id);
    }
    setStatus("Interview link loaded. Click Start Interview.");
  }, []);

  const buildJanusServerList = () => {
    if (!session) {
      return [];
    }

    const wsBase = (session.janus_ws_url || "ws://localhost:8188").replace(/\/$/, "");
    const httpBase = session.janus_http_url || "http://localhost:8088/janus";

    return [wsBase, `${wsBase}/`, `${wsBase}/janus`, httpBase];
  };

  const createSession = async () => {
    setBusy(true);
    setStatus("Creating interview session...");
    try {
      const response = await fetch(`${API_BASE}/session/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidate_id: candidateId || undefined
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details || "Unable to create session");
      }
      setSession(data);
      endPersistedRef.current = false;
      if (!isAttendMode) {
        await loadInterviews();
      }
      setStatus("Session ready. Click Start interview.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const initJanus = async () => {
    if (!janusInitRef.current) {
      await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new Error("Janus initialization timeout"));
        }, 8000);

        Janus.init({
          debug: "all",
          callback: () => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            janusInitRef.current = true;
            resolve(true);
          }
        });
      });
    }

    const serverCandidates = buildJanusServerList();
    if (!serverCandidates.length) {
      throw new Error("No Janus servers configured for this session.");
    }

    setStatus(`Connecting to Janus via ${serverCandidates.join(" | ")}`);
    return new Promise((resolve, reject) => {
      janusRef.current = new Janus({
        server: serverCandidates,
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        success: () => resolve(true),
        error: (err) => reject(err),
        destroyed: () => {
          setIsLive(false);
          setStatus("Janus session destroyed");
          setPerformanceMetrics((prev) => ({
            ...prev,
            webrtcState: "destroyed",
            connectionState: "closed",
            audioActive: false,
            videoActive: false
          }));
        }
      });
    });
  };

  const startInterview = async () => {
    if (!session) {
      setStatus("Create session first.");
      return;
    }

    setBusy(true);
    setIsLive(false);
    setStatus("Requesting camera and microphone...");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 360, max: 720 },
          frameRate: { ideal: 24, max: 30 }
        },
        audio: true
      });
      streamRef.current = media;
      await attachPreviewStream(media);

      await initJanus();
      setStatus("Connecting to Janus VideoRoom...");

      await new Promise((resolve, reject) => {
        janusRef.current.attach({
          plugin: "janus.plugin.videoroom",
          success: (pluginHandle) => {
            pluginRef.current = pluginHandle;
            pluginHandle.send({
              message: {
                request: "join",
                ptype: "publisher",
                room: session.room_id,
                display: candidateId || "candidate"
              }
            });
            resolve(true);
          },
          error: (err) => reject(err),
          onmessage: (msg, jsep) => {
            const event = msg?.videoroom;
            if (event === "joined") {
              setStatus("Joined room. Negotiating media...");
              publishOwnFeed(msg.id);
            }
            if (event === "event" && msg?.error) {
              setStatus(`Janus error: ${msg.error}`);
            }
            if (msg?.error) {
              setStatus(`Janus plugin error: ${msg.error}`);
            }
            if (jsep && pluginRef.current) {
              pluginRef.current.handleRemoteJsep({ jsep });
            }
          },
          webrtcState: (isUp) => {
            setPerformanceMetrics((prev) => ({
              ...prev,
              webrtcState: isUp ? "up" : "down",
              updatedAt: new Date().toLocaleTimeString()
            }));
          },
          iceState: (state) => {
            setPerformanceMetrics((prev) => ({
              ...prev,
              iceState: state,
              updatedAt: new Date().toLocaleTimeString()
            }));
          },
          connectionState: (state) => {
            setPerformanceMetrics((prev) => ({
              ...prev,
              connectionState: state,
              updatedAt: new Date().toLocaleTimeString()
            }));
          },
          mediaState: (medium, on) => {
            setPerformanceMetrics((prev) => ({
              ...prev,
              audioActive: medium === "audio" ? on : prev.audioActive,
              videoActive: medium === "video" ? on : prev.videoActive,
              updatedAt: new Date().toLocaleTimeString()
            }));
          },
          slowLink: () => {
            setPerformanceMetrics((prev) => ({
              ...prev,
              slowLinkCount: prev.slowLinkCount + 1,
              updatedAt: new Date().toLocaleTimeString()
            }));
          },
          oncleanup: () => setStatus("Publisher cleaned up.")
        });
      });
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      lastOutboundRef.current = { bytesSent: null, timestamp: null };
      setPerformanceMetrics((prev) => ({
        ...prev,
        webrtcState: "stopped",
        iceState: "closed",
        connectionState: "closed",
        audioActive: false,
        videoActive: false,
        bitrateKbps: null,
        fps: null,
        updatedAt: new Date().toLocaleTimeString()
      }));
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const publishOwnFeed = async () => {
    const plugin = pluginRef.current;
    const media = streamRef.current;
    if (!plugin || !media || !session) {
      return;
    }

    setStatus("Publishing stream and enabling server recording...");
    plugin.createOffer({
      tracks: [
        { type: "audio", capture: media.getAudioTracks()[0], recv: false },
        { type: "video", capture: media.getVideoTracks()[0], recv: false }
      ],
      success: (jsep) => {
        plugin.send({
          message: {
            request: "publish",
            audio: true,
            video: true,
            bitrate: 512000,
            record: true,
            filename: session.session_id
          },
          jsep
        });
        startedAtRef.current = Date.now();
        endPersistedRef.current = false;
        setIsLive(true);
        setStatus("Live. Janus is recording on the server.");
      },
      error: (err) => {
        setIsLive(false);
        setStatus(`Publish failed: ${err?.message || err}`);
      }
    });
  };

  const stopInterview = async () => {
    if (!isLive) {
      setStatus("Interview is not live yet. Start publishing before ending.");
      return;
    }

    setBusy(true);
    setStatus("Stopping interview...");
    try {
      pluginRef.current?.send({ message: { request: "unpublish" } });
      pluginRef.current?.hangup();
      janusRef.current?.destroy();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      if (session?.session_id) {
        await persistInterviewEnd();
      }

      setIsLive(false);
      if (!isAttendMode) {
        await loadInterviews();
      }
      setStatus("Interview ended. You can process recordings from backend.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container">
      <h1>Candidate Interview Recorder (MVP)</h1>
      <p className="muted">
        Local stack: React candidate app + Node control API + Janus recording.
      </p>

      <SessionControls
        isAttendMode={isAttendMode}
        session={session}
        candidateId={candidateId}
        setCandidateId={setCandidateId}
        busy={busy}
        isLive={isLive}
        canStart={canStart}
        statusMessage=""
        onCreateSession={createSession}
        onStartInterview={startInterview}
        onStopInterview={stopInterview}
        onOpenInterviewLink={() => {
          if (!session?.start_link) {
            setStatus("Create session first to generate interview link.");
            return;
          }
          window.open(session.start_link, "_blank", "noopener,noreferrer");
        }}
        onCopyInterviewLink={async () => {
          if (!session?.start_link) {
            setStatus("Create session first to generate interview link.");
            return;
          }
          try {
            await navigator.clipboard.writeText(session.start_link);
            setStatus("Interview link copied.");
          } catch (_error) {
            setStatus(`Interview link: ${session.start_link}`);
          }
        }}
      />

      <section className="card">
        <h2>Local Preview</h2>
        <video ref={videoRef} autoPlay playsInline muted className="preview" />
      </section>

      <StatusPanel status={status} session={session} isAttendMode={isAttendMode} />

      {isAttendMode ? <AttendPerformancePanel metrics={performanceMetrics} /> : null}

      {!isAttendMode ? (
        <HealthPanel health={health} onRefresh={refreshHealth} busy={adminBusy} />
      ) : null}

      {!isAttendMode ? (
        <AdminPanel
          adminBusy={adminBusy}
          adminStatus={adminStatus}
          candidateFilter={candidateFilter}
          setCandidateFilter={setCandidateFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          fromDateFilter={fromDateFilter}
          setFromDateFilter={setFromDateFilter}
          toDateFilter={toDateFilter}
          setToDateFilter={setToDateFilter}
          onRefreshInterviews={loadInterviews}
          onProcessAll={processAllRecordings}
        />
      ) : null}

      {!isAttendMode ? (
        <InterviewHistory
          interviews={filteredInterviews}
          adminBusy={adminBusy}
          mediaUrl={mediaUrl}
          onProcessSingle={processSingleInterview}
          onDeleteInterview={deleteInterview}
        />
      ) : null}
    </main>
  );
}

export default App;
