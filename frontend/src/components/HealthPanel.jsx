function HealthPanel({ health, onRefresh, busy }) {
  return (
    <section className="card">
      <h2>System Health</h2>
      <div className="row">
        <button onClick={onRefresh} disabled={busy}>
          Refresh Health
        </button>
      </div>
      <p className="muted">
        Backend: {health.backend_ok ? "OK" : "Down"} | Janus: {health.janus_ok ? "OK" : "Down"}
      </p>
      {health.error ? <p className="muted">{health.error}</p> : null}
      <pre>{JSON.stringify(health, null, 2)}</pre>
    </section>
  );
}

export default HealthPanel;
