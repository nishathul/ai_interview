function AttendPerformancePanel({ metrics }) {
  return (
    <section className="card">
      <h2>Performance Monitor</h2>
      <div className="metrics-grid">
        <div className="metric-item">
          <span>Network</span>
          <strong>{metrics.online ? "Online" : "Offline"}</strong>
        </div>
        <div className="metric-item">
          <span>Effective Type</span>
          <strong>{metrics.effectiveType || "unknown"}</strong>
        </div>
        <div className="metric-item">
          <span>RTT</span>
          <strong>{metrics.rttMs != null ? `${metrics.rttMs} ms` : "n/a"}</strong>
        </div>
        <div className="metric-item">
          <span>Downlink</span>
          <strong>{metrics.downlinkMbps != null ? `${metrics.downlinkMbps} Mbps` : "n/a"}</strong>
        </div>
        <div className="metric-item">
          <span>WebRTC</span>
          <strong>{metrics.webrtcState || "n/a"}</strong>
        </div>
        <div className="metric-item">
          <span>ICE</span>
          <strong>{metrics.iceState || "n/a"}</strong>
        </div>
        <div className="metric-item">
          <span>Peer Connection</span>
          <strong>{metrics.connectionState || "n/a"}</strong>
        </div>
        <div className="metric-item">
          <span>Video Active</span>
          <strong>{metrics.videoActive ? "yes" : "no"}</strong>
        </div>
        <div className="metric-item">
          <span>Audio Active</span>
          <strong>{metrics.audioActive ? "yes" : "no"}</strong>
        </div>
        <div className="metric-item">
          <span>Outbound Bitrate</span>
          <strong>{metrics.bitrateKbps != null ? `${metrics.bitrateKbps} kbps` : "n/a"}</strong>
        </div>
        <div className="metric-item">
          <span>FPS</span>
          <strong>{metrics.fps != null ? metrics.fps : "n/a"}</strong>
        </div>
        <div className="metric-item">
          <span>Packet Loss</span>
          <strong>{metrics.packetsLost != null ? metrics.packetsLost : "n/a"}</strong>
        </div>
      </div>
      <p className="muted">
        Slow-link events: {metrics.slowLinkCount} | Last updated: {metrics.updatedAt || "n/a"}
      </p>
    </section>
  );
}

export default AttendPerformancePanel;
