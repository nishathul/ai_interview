function SessionControls({
  isAttendMode,
  session,
  candidateId,
  setCandidateId,
  busy,
  isLive,
  canStart,
  statusMessage,
  onCreateSession,
  onStartInterview,
  onStopInterview,
  onOpenInterviewLink,
  onCopyInterviewLink
}) {
  return (
    <section className="card">
      {!isAttendMode ? (
        <>
          <label htmlFor="candidateId">Candidate ID (optional)</label>
          <input
            id="candidateId"
            value={candidateId}
            placeholder="candidate_001"
            onChange={(event) => setCandidateId(event.target.value)}
          />
        </>
      ) : (
        <p className="muted">
          Attendee view: this page is only for attending interview `{session?.session_id || ""}`.
        </p>
      )}
      <div className="row">
        {!isAttendMode ? (
          <button onClick={onCreateSession} disabled={busy}>
            1) Create Session
          </button>
        ) : null}
        <button onClick={onStartInterview} disabled={busy || !canStart}>
          {isAttendMode ? "Start Interview" : "2) Start Interview"}
        </button>
        <button onClick={onStopInterview} disabled={busy || !isLive}>
          {isAttendMode ? "End Interview" : "3) End Interview"}
        </button>
        {!isAttendMode ? (
          <>
            <button onClick={onOpenInterviewLink} disabled={busy || !session}>
              Open Interview Link
            </button>
            <button onClick={onCopyInterviewLink} disabled={busy || !session}>
              Copy Interview Link
            </button>
          </>
        ) : null}
      </div>
      {!isAttendMode && session?.start_link ? (
        <p className="muted">
          Share link:{" "}
          <a href={session.start_link} target="_blank" rel="noreferrer">
            {session.start_link}
          </a>
        </p>
      ) : null}
      {!isAttendMode && statusMessage ? <p className="muted">{statusMessage}</p> : null}
    </section>
  );
}

export default SessionControls;
