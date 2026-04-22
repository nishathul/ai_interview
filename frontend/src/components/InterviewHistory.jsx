function InterviewHistory({
  interviews,
  adminBusy,
  mediaUrl,
  onProcessSingle,
  onDeleteInterview
}) {
  return (
    <section className="card">
      <h2>Interview History</h2>
      {!interviews.length ? (
        <p className="muted">No interviews match current filters.</p>
      ) : (
        interviews.map((item) => {
          const preview =
            item.converted_recordings?.find((file) => file.name.includes("-merged.")) ||
            item.converted_recordings?.[0];
          return (
            <article className="card inner" key={item.session_id}>
              <h3>{item.session_id}</h3>
              <p>
                Candidate: {item.candidate_id} | Room: {item.room_id} | Status: {item.status}
              </p>
              <p>
                Ended at: {item.ended_at || "N/A"} | Duration: {item.duration_seconds || 0}s
              </p>
              <div className="row">
                <button disabled={adminBusy} onClick={() => onProcessSingle(item.session_id)}>
                  Convert This Interview
                </button>
                <button disabled={adminBusy} onClick={() => onDeleteInterview(item.session_id)}>
                  Delete Interview
                </button>
              </div>
              <p className="muted">Raw .mjr files</p>
              {!item.raw_recordings?.length ? (
                <p>No raw files yet.</p>
              ) : (
                <ul>
                  {item.raw_recordings.map((file) => (
                    <li key={file.name}>
                      <a href={mediaUrl(file.url)} target="_blank" rel="noreferrer">
                        {file.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted">Converted recordings</p>
              {!item.converted_recordings?.length ? (
                <p>Not converted yet.</p>
              ) : (
                <ul>
                  {item.converted_recordings.map((file) => (
                    <li key={file.name}>
                      <a href={mediaUrl(file.url)} target="_blank" rel="noreferrer">
                        {file.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {preview ? <video controls className="preview" src={mediaUrl(preview.url)} /> : null}
            </article>
          );
        })
      )}
    </section>
  );
}

export default InterviewHistory;
