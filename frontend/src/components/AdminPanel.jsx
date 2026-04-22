function AdminPanel({
  adminBusy,
  adminStatus,
  candidateFilter,
  setCandidateFilter,
  statusFilter,
  setStatusFilter,
  fromDateFilter,
  setFromDateFilter,
  toDateFilter,
  setToDateFilter,
  onRefreshInterviews,
  onProcessAll
}) {
  return (
    <section className="card">
      <h2>Interview Admin</h2>
      <p className="muted">Manage interviews, filter history, and process recordings.</p>
      <div className="grid">
        <div>
          <label htmlFor="candidateFilter">Candidate</label>
          <input
            id="candidateFilter"
            value={candidateFilter}
            placeholder="candidate_001"
            onChange={(event) => setCandidateFilter(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="statusFilter">Status</label>
          <select
            id="statusFilter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="ended">Ended</option>
            <option value="created">Created</option>
          </select>
        </div>
        <div>
          <label htmlFor="fromDateFilter">Ended from</label>
          <input
            id="fromDateFilter"
            type="date"
            value={fromDateFilter}
            onChange={(event) => setFromDateFilter(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="toDateFilter">Ended to</label>
          <input
            id="toDateFilter"
            type="date"
            value={toDateFilter}
            onChange={(event) => setToDateFilter(event.target.value)}
          />
        </div>
      </div>
      <div className="row">
        <button disabled={adminBusy} onClick={onRefreshInterviews}>
          Refresh Interviews
        </button>
        <button disabled={adminBusy} onClick={onProcessAll}>
          Process All .mjr
        </button>
        <button
          disabled={adminBusy}
          onClick={() => {
            setCandidateFilter("");
            setStatusFilter("all");
            setFromDateFilter("");
            setToDateFilter("");
          }}
        >
          Clear Filters
        </button>
      </div>
      <pre>{adminStatus}</pre>
    </section>
  );
}

export default AdminPanel;
