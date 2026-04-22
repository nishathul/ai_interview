function StatusPanel({ status, session, isAttendMode }) {
  return (
    <section className="card">
      <h2>Status</h2>
      <pre>{status}</pre>
      {!isAttendMode && session ? (
        <pre>{JSON.stringify(session, null, 2)}</pre>
      ) : isAttendMode && session ? (
        <p className="muted">Session: {session.session_id}</p>
      ) : (
        <p className="muted">No session created yet.</p>
      )}
    </section>
  );
}

export default StatusPanel;
