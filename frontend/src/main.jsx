import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useNavigate,
  useParams,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
} from "react-router-dom";
import { api } from "./lib/api";
import "./styles.css";

const getUser = () => JSON.parse(localStorage.getItem("user") || "null");
const ROLE = {
  PLATFORM_ADMIN: "PLATFORM_ADMIN",
  HOSPITAL_ADMIN: "HOSPITAL_ADMIN",
  CAMPAIGN_MANAGER: "CAMPAIGN_MANAGER",
  CLINICAL_REVIEWER: "CLINICAL_REVIEWER",
};

const roleLabel = (role = "") =>
  role
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const canManageCampaigns = () =>
  [ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CAMPAIGN_MANAGER].includes(
    getUser()?.role,
  );

const canViewQueue = () =>
  [ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CAMPAIGN_MANAGER].includes(
    getUser()?.role,
  );

const canViewReviews = () =>
  [ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CLINICAL_REVIEWER].includes(
    getUser()?.role,
  );

function Login() {
  const [email, setEmail] = useState("manager@hospital-a.local");
  const [password, setPassword] = useState("demo123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", r.data.token);
      localStorage.setItem("user", JSON.stringify(r.data.user));
      const role = r.data.user.role;
      nav(
        role === ROLE.CLINICAL_REVIEWER
          ? "/reviews"
          : role === ROLE.CAMPAIGN_MANAGER
            ? "/campaigns"
            : "/",
      );
    } catch (e) {
      setErr(e.response?.data?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="brand-mark">C</div>
        <div>
          <strong>CareFlow AI</strong>
          <span>Post-discharge outreach operations</span>
        </div>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <div className="eyebrow">STAFF PORTAL</div>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to manage your hospital outreach workflow.</p>
        <label>Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@hospital.com"
          autoComplete="email"
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
        />
        <button className="primary wide" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {err && <div className="alert error">{err}</div>}
        <small className="demo-note">Demo password: demo123</small>
      </form>
    </div>
  );
}

function Layout({ children }) {
  const u = getUser();
  const nav = useNavigate();
  const location = useLocation();

  if (!u) return <Navigate to="/login" replace />;

  const navItems = [
    { to: "/", label: "Dashboard", show: u.role !== ROLE.CLINICAL_REVIEWER },
    { to: "/hospitals", label: "Hospitals", show: [ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN].includes(u.role) },
    { to: "/knowledge", label: "Knowledge", show: [ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN].includes(u.role) },
    { to: "/campaigns", label: "Campaigns", show: canManageCampaigns() },
    { to: "/queue", label: "Outreach Queue", show: canViewQueue() },
    { to: "/simulation", label: "Queue Simulation", show: canViewQueue() },
    { to: "/reviews", label: "Clinical Review", show: canViewReviews() },
  ].filter((x) => x.show);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to={u.role === ROLE.CLINICAL_REVIEWER ? "/reviews" : "/"} className="brand">
          <div className="brand-mark">C</div>
          <div>
            <strong>CareFlow</strong>
            <span>AI Operations</span>
          </div>
        </Link>

        <div className="sidebar-section-title">WORKSPACE</div>
        <nav className="side-nav">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={location.pathname === item.to ? "active" : ""}
            >
              <span className="nav-dot" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="role-card">
            <div className="avatar">{(u.name || "U").charAt(0).toUpperCase()}</div>
            <div className="role-info">
              <strong>{u.name}</strong>
              <span>{roleLabel(u.role)}</span>
            </div>
          </div>
          <button
            className="sidebar-logout"
            onClick={() => {
              localStorage.clear();
              nav("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div>
            <span className="topbar-label">HOSPITAL OUTREACH</span>
            <h1>{pageTitle(location.pathname)}</h1>
          </div>
          <div className="topbar-user">
            <span className="status-dot" />
            {roleLabel(u.role)}
          </div>
        </header>
        <main className="page-content">{children}</main>
      </section>
    </div>
  );
}

function pageTitle(path) {
  if (path.startsWith("/hospitals")) return "Hospital Configuration";
  if (path.startsWith("/knowledge")) return "Hospital Knowledge";
  if (path.startsWith("/campaigns")) return "Campaigns";
  if (path.startsWith("/queue")) return "Outreach Queue";
  if (path.startsWith("/simulation")) return "Queue Simulation";
  if (path.startsWith("/reviews")) return "Clinical Review";
  return "Operations Dashboard";
}

function ProtectedRoute({ children, roles: allowedRoles }) {
  const u = getUser();
  if (!u) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(u.role)) {
    const fallback = u.role === ROLE.CLINICAL_REVIEWER ? "/reviews" : "/";
    return <Navigate to={fallback} replace />;
  }
  return children;
}

function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setD((await api.get("/dashboard/summary")).data);
    } catch (e) {
      setErr(e.response?.data?.message || "Could not load dashboard");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const metrics = d
    ? [
        ["Patients", d.patients, "Total patients"],
        ["Pending outreach", d.pending, "Waiting to be contacted"],
        ["Completed", d.completed, "Completed follow-ups"],
        ["Open escalations", d.openEscalations, "Needs clinical attention"],
        ["AI processing", d.aiProcessing, "Currently being assessed"],
        ["EHR updates", d.ehrUpdates, "Recorded follow-ups"],
        ["Queue depth", d.pending, "Pending and scheduled work"],
        ["Active capacity", `${d.active ?? 0}`, "Currently reserved/calling"],
        ["Cutoff risk", d.cutoffRisk, "Patients nearing clinical cutoff"],
        ["Retry backlog", d.retries, "Waiting for another attempt"],
        ["Manual follow-up", d.manualFollowUps, "Requires staff action"],
        ["Workflow failures", d.workflowFailures, "Failed asynchronous events"],
        ["Notification failures", d.notificationFailures, "Staff notification delivery failures"],
      ]
    : [];

  return (
    <Layout>
      <div className="page-intro">
        <div>
          <div className="eyebrow">TODAY'S OPERATIONS</div>
          <h2>Keep every follow-up moving.</h2>
          <p className="muted">Monitor outreach, AI processing and clinical escalation from one place.</p>
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}
      <div className="metric-grid">
        {metrics.map(([label, value, hint]) => (
          <div className="metric-card" key={label}>
            <span className="metric-label">{label}</span>
            <strong>{value ?? 0}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">WORKFLOW</span>
              <h3>End-to-end follow-up</h3>
            </div>
          </div>
          <div className="workflow">
            {["Eligibility", "Outreach", "Patient response", "AI triage", "Protocol check", "EHR / Review"].map((x, i) => (
              <div className="workflow-step" key={x}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{x}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel ai-summary">
          <div>
            <span className="eyebrow">AI MONITORING</span>
            <h3>Processing health</h3>
          </div>
          <div className="ai-row"><span>Processing</span><b>{d?.aiProcessing ?? 0}</b></div>
          <div className="ai-row"><span>Human review</span><b>{d?.aiHumanReview ?? 0}</b></div>
          <div className="ai-row"><span>Failed</span><b>{d?.aiFailed ?? 0}</b></div>
        </section>
      </div>
    </Layout>
  );
}

function Hospitals() {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({ name: "", code: "", contactEmail: "", timezone: "Asia/Kolkata" });
  const u = getUser();

  async function load() { try { setRows((await api.get("/hospitals")).data); } catch (e) { setMsg(e.response?.data?.message || "Could not load hospitals"); } }
  useEffect(() => { load(); }, []);
  async function save(id, value) {
    try { await api.patch(`/hospitals/${id}/config`, value); setMsg("Hospital configuration saved."); await load(); }
    catch (e) { setMsg(e.response?.data?.message || "Could not save hospital configuration"); }
  }
  async function create() {
    if (!draft.name || !draft.code) return setMsg("Hospital name and code are required.");
    try { await api.post("/hospitals", draft); setDraft({ name: "", code: "", contactEmail: "", timezone: "Asia/Kolkata" }); setMsg("Hospital created."); await load(); }
    catch (e) { setMsg(e.response?.data?.message || "Could not create hospital"); }
  }

  return <Layout>
    <div className="page-intro compact"><div><div className="eyebrow">TENANT CONFIGURATION</div><h2>Hospitals</h2><p className="muted">Configure timezone, calling windows, capacity, retry policy and escalation contacts.</p></div></div>
    {msg && <div className="alert success">{msg}</div>}
    {u.role === ROLE.PLATFORM_ADMIN && <section className="panel config-panel"><div className="section-title"><h3>Create hospital tenant</h3></div><div className="form-grid"><input placeholder="Hospital name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/><input placeholder="Code e.g. HOSP-C" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })}/><input placeholder="Contact email" value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}/><input placeholder="Timezone" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}/></div><button className="primary" onClick={create}>Create hospital</button></section>}
    <div className="config-list">{rows.map((h) => <HospitalCard key={h._id} hospital={h} onSave={save}/>)}</div>
  </Layout>;
}

function HospitalCard({ hospital, onSave }) {
  const [form, setForm] = useState({ ...hospital });
  const [users, setUsers] = useState([]);
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "demo123", role: "CAMPAIGN_MANAGER" });
  const [userMsg, setUserMsg] = useState("");
  async function loadUsers() { try { setUsers((await api.get(`/hospitals/${hospital._id}/users`)).data); } catch {} }
  useEffect(() => { loadUsers(); }, [hospital._id]);
  async function addUser() {
    try { await api.post(`/hospitals/${hospital._id}/users`, userForm); setUserMsg("User assigned."); setUserForm({ name: "", email: "", password: "demo123", role: "CAMPAIGN_MANAGER" }); await loadUsers(); }
    catch (e) { setUserMsg(e.response?.data?.message || "Could not assign user"); }
  }
  return <section className="panel config-panel">
    <div className="panel-heading"><div><span className="eyebrow">{hospital.code}</span><h3>{hospital.name}</h3></div><Status value={hospital.status}/></div>
    <div className="form-grid">
      <label>Hospital name<input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
      <label>Contact email<input value={form.contactEmail || ""} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}/></label>
      <label>Timezone<input value={form.timezone || "Asia/Kolkata"} onChange={(e) => setForm({ ...form, timezone: e.target.value })}/></label>
      <label>Capacity<input type="number" min="1" value={form.outboundCapacity || 1} onChange={(e) => setForm({ ...form, outboundCapacity: Number(e.target.value) })}/></label>
      <label>Calling start<input value={form.callingHours?.start || "09:00"} onChange={(e) => setForm({ ...form, callingHours: { ...(form.callingHours || {}), start: e.target.value } })}/></label>
      <label>Calling end<input value={form.callingHours?.end || "18:00"} onChange={(e) => setForm({ ...form, callingHours: { ...(form.callingHours || {}), end: e.target.value } })}/></label>
      <label>Max attempts<input type="number" min="1" value={form.retry?.maxAttempts || 3} onChange={(e) => setForm({ ...form, retry: { ...(form.retry || {}), maxAttempts: Number(e.target.value) } })}/></label>
      <label>Backoff minutes<input type="number" min="1" value={form.retry?.backoffMinutes || 5} onChange={(e) => setForm({ ...form, retry: { ...(form.retry || {}), backoffMinutes: Number(e.target.value) } })}/></label>
    </div>
    <div className="config-actions"><button className="primary" onClick={() => onSave(hospital._id, { name: form.name, contactEmail: form.contactEmail, timezone: form.timezone, outboundCapacity: form.outboundCapacity, callingHours: form.callingHours, retry: form.retry })}>Save configuration</button></div>
    <div className="section-title"><h3>Assigned hospital users</h3></div>
    <div className="user-list">{users.map((x) => <div className="user-row" key={x._id}><strong>{x.name}</strong><span>{x.role.replaceAll("_", " ")}</span><small>{x.email}</small></div>)}</div>
    <div className="form-grid user-form"><input placeholder="Name" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}/><input placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}/><input placeholder="Password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}/><select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}><option>HOSPITAL_ADMIN</option><option>CAMPAIGN_MANAGER</option><option>CLINICAL_REVIEWER</option></select></div>
    <button onClick={addUser}>Assign user</button>{userMsg && <small className="table-subtext">{userMsg}</small>}
  </section>;
}

function Knowledge() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ title: "", sourceReference: "", content: "", tags: "post-discharge" });
  const [msg, setMsg] = useState("");
  async function load() { try { setRows((await api.get("/knowledge")).data); } catch (e) { setMsg(e.response?.data?.message || "Could not load knowledge"); } }
  useEffect(() => { load(); }, []);
  async function create() {
    try { await api.post("/knowledge", { ...form, tags: form.tags.split(",").map((x) => x.trim()).filter(Boolean) }); setForm({ title: "", sourceReference: "", content: "", tags: "post-discharge" }); setMsg("Knowledge resource added."); await load(); }
    catch (e) { setMsg(e.response?.data?.message || "Could not add knowledge resource"); }
  }
  return <Layout>
    <div className="page-intro compact"><div><div className="eyebrow">TENANT-AWARE RETRIEVAL</div><h2>Hospital knowledge</h2><p className="muted">Add hospital-approved guidance that can be retrieved with the active protocol for AI grounding.</p></div></div>
    {msg && <div className="alert success">{msg}</div>}
    <section className="panel config-panel"><div className="section-title"><h3>Add knowledge resource</h3></div><div className="form-grid"><input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}/><input placeholder="Source reference" value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })}/><input placeholder="Tags, comma separated" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}/></div><textarea className="knowledge-textarea" placeholder="Hospital-approved guidance" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}/><button className="primary" onClick={create}>Add resource</button></section>
    <section className="knowledge-list">{rows.map((x) => <article className="panel knowledge-card" key={x._id}><div className="panel-heading"><div><span className="eyebrow">{x.type}</span><h3>{x.title}</h3></div><Status value={x.active ? "ACTIVE" : "INACTIVE"}/></div><p>{x.content}</p><small>{x.sourceReference || "No source reference"}</small></article>)}</section>
  </Layout>;
}

function Campaigns() {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => api.get("/campaigns").then((r) => setRows(r.data)).catch((e) => setMsg(e.response?.data?.message || "Could not load campaigns"));
  useEffect(() => { load(); }, []);

  async function action(id, status) {
    setBusy(`${id}:${status}`); setMsg("");
    try {
      await api.post(`/campaigns/${id}/transition`, { status });
      setMsg(`Campaign moved to ${status}.`); await load();
    } catch (e) { setMsg(e.response?.data?.message || "Campaign action failed"); }
    finally { setBusy(""); }
  }

  async function run(id) {
    setBusy(`${id}:eligibility`); setMsg("");
    try {
      const r = await api.post(`/campaigns/${id}/eligibility/run`);
      setMsg(`Eligibility complete: ${r.data.eligible} eligible, ${r.data.tasksCreated} new queue tasks.`); await load();
    } catch (e) { setMsg(e.response?.data?.message || "Eligibility failed"); }
    finally { setBusy(""); }
  }

  async function estimate(id) {
    try {
      const r = await api.post(`/campaigns/${id}/workload/estimate`);
      setMsg(`Estimated workload: ${r.data.eligiblePatients} patients / ${r.data.expectedAttempts} expected attempts.`); await load();
    } catch (e) { setMsg(e.response?.data?.message || "Could not estimate workload"); }
  }

  return (
    <Layout>
      <div className="page-intro compact"><div><div className="eyebrow">OUTREACH PROGRAMS</div><h2>Campaign operations</h2><p className="muted">Configure lifecycle state, estimate workload and move eligible patients into the prioritized queue.</p></div></div>
      {msg && <div className={msg.includes("failed") || msg.includes("Could not") ? "alert error" : "alert success"}>{msg}</div>}
      <section className="panel table-panel">
        <table><thead><tr><th>Campaign</th><th>Status</th><th>Window</th><th>Capacity</th><th>Workload</th><th>Controls</th></tr></thead>
          <tbody>{rows.map((c) => {
            const key = (status) => `${c._id}:${status}`;
            return <tr key={c._id}>
              <td><strong>{c.name}</strong><small className="table-subtext">{c.description || "Post-discharge outreach"}</small></td>
              <td><Status value={c.status} /></td>
              <td>{c.followUpDays} days</td>
              <td>{c.outboundCapacity || "Hospital"}</td>
              <td>{c.estimatedWorkload?.eligiblePatients ?? "—"}</td>
              <td className="align-right controls-cell">
                <button disabled={!!busy} onClick={() => estimate(c._id)}>Estimate</button>
                <button disabled={!!busy} onClick={() => run(c._id)}>Eligibility</button>
                {c.status === "DRAFT" && <button disabled={!!busy} onClick={() => action(c._id, "READY")}>Ready</button>}
                {c.status === "READY" && <button disabled={!!busy} onClick={() => action(c._id, "RUNNING")}>Start</button>}
                {c.status === "SCHEDULED" && <button disabled={!!busy} onClick={() => action(c._id, "RUNNING")}>Start</button>}
                {c.status === "RUNNING" && <button disabled={!!busy} onClick={() => action(c._id, "PAUSED")}>Pause</button>}
                {c.status === "PAUSED" && <button disabled={!!busy} onClick={() => action(c._id, "RUNNING")}>Resume</button>}
              </td>
            </tr>;
          })}{!rows.length && <tr><td colSpan="6" className="empty">No campaigns found.</td></tr>}</tbody>
        </table>
      </section>
    </Layout>
  );
}

function Queue() {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  async function load() {
    try { setRows((await api.get("/queue")).data); }
    catch (e) { setMsg(e.response?.data?.message || "Could not load queue"); }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function processQueue() {
    setMsg("");
    try {
      const r = await api.post("/queue/process");
      setMsg(`${r.data.sent} outreach email(s) sent.`);
      await load();
    } catch (e) { setMsg(e.response?.data?.message || "Queue processing failed"); }
  }

  async function openPatient(row) {
    setSelected(row);
    setDetail(null);
    setDetailBusy(true);
    try {
      const r = await api.get(`/queue/${row._id}/detail`);
      setDetail(r.data);
    } catch (e) {
      setMsg(e.response?.data?.message || "Could not load patient record");
    } finally { setDetailBusy(false); }
  }

  return (
    <Layout>
      <div className="page-intro compact queue-head">
        <div>
          <div className="eyebrow">PRIORITIZED WORKLIST</div>
          <h2>Outreach queue</h2>
          <p className="muted">Select a patient to review their EHR, responses and AI assessments.</p>
        </div>
        <button onClick={processQueue}>Process queue</button>
      </div>
      {msg && <div className="alert success">{msg}</div>}
      <section className="panel table-panel">
        <table>
          <thead><tr><th>Patient</th><th>Task</th><th>AI status</th><th>Classification</th><th>Priority</th><th>Attempts</th><th>Deadline</th></tr></thead>
          <tbody>
            {rows.map((x) => {
              const classification = x.latestAIAssessment?.classification || x.classification || "";
              return (
                <tr key={x._id} className="clickable-row" onClick={() => openPatient(x)}>
                  <td><strong>{x.patientId?.name || "Unknown patient"}</strong></td>
                  <td><Status value={x.status} /></td>
                  <td>
                    <Status value={x.aiProcessingStatus || "NOT_STARTED"} />
                    {x.aiProcessingError && <small className="row-error">{x.aiProcessingError}</small>}
                  </td>
                  <td>{classification ? <Status value={classification} /> : <span className="muted">Pending assessment</span>}</td>
                  <td><span className="priority-value">{x.priorityScore ?? 0}</span></td>
                  <td>{x.attempts ?? 0}</td>
                  <td>{x.deadline ? new Date(x.deadline).toLocaleString() : "—"}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan="7" className="empty">No outreach tasks in the queue.</td></tr>}
          </tbody>
        </table>
      </section>

      {selected && <PatientDrawer row={selected} detail={detail} loading={detailBusy} onClose={() => { setSelected(null); setDetail(null); }} />}
    </Layout>
  );
}

function PatientDrawer({ row, detail, loading, onClose }) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="patient-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">PATIENT RECORD</span>
            <h2>{detail?.patient?.name || row.patientId?.name || "Patient"}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
        {loading ? <div className="drawer-loading">Loading patient record…</div> : detail ? (
          <div className="drawer-body">
            <div className="detail-grid">
              <Detail label="Task status" value={<Status value={detail.task?.status} />} />
              <Detail label="AI status" value={<Status value={detail.task?.aiProcessingStatus} />} />
              <Detail label="Priority" value={detail.task?.priorityScore ?? 0} />
              <Detail label="Campaign" value={detail.campaign?.name || "—"} />
              <Detail label="Deadline pressure" value={`${detail.priorityBreakdown?.hoursRemaining ?? "—"}h remaining`} />
            </div>
            <section className="drawer-section">
              <SectionTitle title="Patient information" />
              <div className="info-list">
                <div><span>Email</span><b>{detail.patient?.email || "—"}</b></div>
                <div><span>Phone</span><b>{detail.patient?.phone || "—"}</b></div>
                <div><span>Hospital</span><b>{detail.hospital?.name || "—"}</b></div>
              </div>
            </section>
            <section className="drawer-section">
              <SectionTitle title="Outreach timeline" />
              {detail.task?.outcomeHistory?.length ? detail.task.outcomeHistory.slice().reverse().map((h, i) => <div className="timeline-item" key={`${h.at || i}-${i}`}><Status value={h.status}/><span>{h.note || "Queue state transition"}</span><small>{h.at ? new Date(h.at).toLocaleString() : ""}</small></div>) : <p className="muted">No queue transitions recorded yet.</p>}
            </section>
            <section className="drawer-section">
              <SectionTitle title="EHR history" />
              {detail.ehr?.length ? detail.ehr.map((e) => (
                <div className="ehr-item" key={e._id}>
                  <div><Status value={e.followUpStatus || "RECORD"} /><span>{e.source || "EHR"}</span></div>
                  <p>{e.summary || "No summary"}</p>
                  <small>{e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</small>
                </div>
              )) : <p className="muted">No EHR records found.</p>}
            </section>
            <section className="drawer-section">
              <SectionTitle title="Patient responses" />
              {detail.responses?.length ? detail.responses.map((r) => (
                <div className="response-item" key={r._id}>
                  <strong>{r.question || r.questionId}</strong>
                  <p>{r.transcript || r.text || "Voice response recorded."}</p>
                  {r.audio?.secureUrl && <audio controls preload="none" src={r.audio.secureUrl} />}
                </div>
              )) : <p className="muted">No responses recorded.</p>}
            </section>
            <section className="drawer-section">
              <SectionTitle title="AI assessments" />
              {detail.assessments?.length ? detail.assessments.map((a) => (
                <div className="assessment-card" key={a._id}>
                  <div className="assessment-top"><strong>Assessment {a.assessmentNo}</strong><Status value={a.classification} /></div>
                  <div className="assessment-meta">Uncertainty: {a.uncertainty || "—"} · Human review: {a.requiresHumanReview ? "Yes" : "No"}</div>
                  {a.evidence?.length > 0 && <p><b>Evidence:</b> {a.evidence.join("; ")}</p>}
                </div>
              )) : <p className="muted">No AI assessment records yet.</p>}
            </section>
          </div>
        ) : <div className="drawer-loading">No patient record available.</div>}
      </aside>
    </div>
  );
}

function Detail({ label, value }) { return <div className="detail-card"><span>{label}</span><b>{value}</b></div>; }
function SectionTitle({ title }) { return <div className="section-title"><h3>{title}</h3></div>; }

function Status({ value }) {
  const clean = String(value || "—").replaceAll("_", " ");
  return <span className={`status ${String(value || "unknown").toLowerCase()}`}>{clean}</span>;
}

function Simulation() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData((await api.get("/simulation/status")).data); }
    catch (e) { setMsg(e.response?.data?.message || "Could not load simulation"); }
  }
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (data?.run?.status !== "RUNNING") return;
    const t = setInterval(() => api.post("/simulation/step").then(load).catch(() => {}), Math.max(1500, data.run.speedMs || 2500));
    return () => clearInterval(t);
  }, [data?.run?.status, data?.run?.speedMs]);

  async function post(path) {
    setBusy(true); setMsg("");
    try { await api.post(`/simulation/${path}`); await load(); }
    catch (e) { setMsg(e.response?.data?.message || "Simulation action failed"); }
    finally { setBusy(false); }
  }

  const run = data?.run;
  const tasks = data?.tasks || [];
  return <Layout>
    <div className="page-intro compact queue-head"><div><div className="eyebrow">MANDATORY PRD DEMONSTRATION</div><h2>Queue simulation</h2><p className="muted">The same seeded demo patients are reused here to demonstrate constrained capacity, deadline pressure, retries, callbacks, dropped calls and escalations without paid telephony.</p></div><div className="simulation-actions"><button onClick={() => post("reset")} disabled={busy}>Reset</button><button className="primary" onClick={() => post("start")} disabled={busy}>Start</button><button onClick={() => post("pause")} disabled={busy}>Pause</button><button onClick={() => post("step")} disabled={busy}>Step</button></div></div>
    {msg && <div className="alert error">{msg}</div>}
    <div className="metric-grid simulation-metrics">
      <div className="metric-card"><span className="metric-label">Simulation</span><strong>{run?.status || "IDLE"}</strong><small>Tick {run?.tick ?? 0}</small></div>
      <div className="metric-card"><span className="metric-label">Active capacity</span><strong>{data?.active ?? 0}</strong><small>Reserved / calling</small></div>
      <div className="metric-card"><span className="metric-label">Total tasks</span><strong>{run?.totalTasks ?? tasks.length}</strong><small>Seeded demo tasks for this hospital</small></div>
      <div className="metric-card"><span className="metric-label">Remaining</span><strong>{tasks.filter((x) => !["COMPLETED","ESCALATED","MANUAL_FOLLOW_UP","FAILED"].includes(x.status)).length}</strong><small>Work still in queue</small></div>
    </div>
    <section className="panel table-panel"><table><thead><tr><th>Patient</th><th>Risk</th><th>Scenario</th><th>Status</th><th>Priority</th><th>Attempt</th><th>Deadline</th></tr></thead><tbody>{tasks.map((x) => <tr key={x._id}><td><strong>{x.patientId?.name}</strong></td><td><Status value={x.patientId?.risk} /></td><td><span className="simulation-scenario">{x.simulation?.scenario}</span></td><td><Status value={x.status} /></td><td>{x.priorityScore}</td><td>{x.attempts}</td><td>{x.deadline ? new Date(x.deadline).toLocaleString() : "—"}</td></tr>)}</tbody></table></section>
  </Layout>;
}

function Reviews() {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(null);

  const load = () =>
    api.get("/reviews")
      .then((r) => setRows(r.data))
      .catch((e) => setMsg(e.response?.data?.message || "Could not load reviews"));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function reviewAction(id, action, body = {}) {
    try { await api.post(`/reviews/${id}/${action}`, body); setMsg(`Escalation ${action.replaceAll("_", " ")} completed.`); load(); }
    catch (e) { setMsg(e.response?.data?.message || `Could not ${action}`); }
  }
  async function resolve(id) {
    const resolution = prompt("Reviewer resolution");
    if (!resolution) return;
    await reviewAction(id, "resolve", { resolution, updateEhr: true });
  }

  return (
    <Layout>
      <div className="page-intro compact">
        <div>
          <div className="eyebrow">HUMAN-IN-THE-LOOP</div>
          <h2>Clinical review</h2>
          <p className="muted">Review AI-flagged cases and document the clinical resolution.</p>
        </div>
        <div className="review-count">{rows.length} open</div>
      </div>
      {msg && <div className="alert success">{msg}</div>}
      {!rows.length && <div className="panel empty-panel"><strong>No open clinical escalations.</strong><span>Cases requiring review will appear here.</span></div>}
      <div className="review-list">
        {rows.map((x) => {
          const expanded = open === x._id;
          return (
            <section className="review-card" key={x._id}>
              <button className="review-summary" onClick={() => setOpen(expanded ? null : x._id)}>
                <div className="review-patient"><div className="avatar large">{(x.patientId?.name || "P").charAt(0).toUpperCase()}</div><div><strong>{x.patientId?.name || "Patient"}</strong><span>{x.reason}</span></div></div>
                <div className="review-summary-right"><Status value={x.priority} /><Status value={x.status} /><span className="chevron">{expanded ? "−" : "+"}</span></div>
              </button>
              {expanded && <div className="review-detail">
                <div className="review-reason"><span>Escalation reason</span><p>{x.reason}</p></div>
                <div className="ai-box">
                  <div className="section-title"><h3>AI assessments</h3></div>
                  {x.aiAssessments?.length ? x.aiAssessments.map((a) => (
                    <div key={a._id} className="assessment-card">
                      <div className="assessment-top"><strong>Assessment {a.assessmentNo}</strong><Status value={a.classification} /></div>
                      <div className="assessment-meta">Uncertainty: {a.uncertainty || "—"} · Human review: {a.requiresHumanReview ? "Yes" : "No"}</div>
                      {a.evidence?.length > 0 && <p><b>Evidence:</b> {a.evidence.join("; ")}</p>}
                    </div>
                  )) : <p className="muted">No AI assessment record yet.</p>}
                </div>
                {x.status !== "RESOLVED" && x.status !== "CLOSED" && <div className="review-actions"><button onClick={() => reviewAction(x._id, "acknowledge")}>Acknowledge</button><button onClick={() => reviewAction(x._id, "wait")}>Need information</button><button onClick={() => resolve(x._id)}>Resolve + update EHR</button></div>}
              </div>}
            </section>
          );
        })}
      </div>
    </Layout>
  );
}

function PatientFollowup() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [recordingId, setRecordingId] = useState(null);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [msg, setMsg] = useState("");
  const recorderRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    api.get(`/patient/outreach/${token}`)
      .then((r) => {
        setData(r.data);
        const saved = Object.fromEntries((r.data.savedResponses || []).map((x) => [x.questionId, x]));
        setAnswers(saved);
      })
      .catch((e) => setMsg(e.response?.data?.message || "Invalid link"));
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    };
  }, [token]);

  async function saveText(qid, text) {
    const fd = new FormData();
    fd.append("questionId", qid);
    fd.append("text", text);
    const response = await api.post(`/patient/outreach/${token}/response`, fd);
    setAnswers((a) => ({ ...a, [qid]: response.data }));
  }

  async function startRecording(qid) {
    if (recordingId) return;
    setMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        const actualType = mr.mimeType || mimeType || "audio/webm";
        const ext = actualType.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(chunks, { type: actualType });
        if (!blob.size) { setRecordingId(null); return; }
        const fd = new FormData();
        fd.append("questionId", qid);
        fd.append("audio", blob, `answer.${ext}`);
        setBusy(true);
        try {
          const response = await api.post(`/patient/outreach/${token}/response`, fd);
          setAnswers((a) => ({ ...a, [qid]: response.data }));
        } catch (e) {
          setMsg(e.response?.data?.message || "Could not save voice answer");
        } finally {
          setBusy(false);
          setRecordingId(null);
          setRecordingElapsed(0);
          recorderRef.current = null;
        }
      };
      mr.start();
      recorderRef.current = mr;
      setRecordingId(qid);
      setRecordingElapsed(0);
      timerRef.current = setInterval(() => setRecordingElapsed((s) => s + 1), 1000);
    } catch (e) {
      setMsg("Microphone access is required to record a voice answer.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api.post(`/patient/outreach/${token}/submit`);
      setSubmitted(true);
      setMsg(r.data.message || "Follow-up submitted successfully. Your responses have been received.");
    } catch (e) { setMsg(e.response?.data?.message || "Could not submit"); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="patient-shell"><div className="patient-loading">{msg || "Loading follow-up…"}</div></div>;

  const requiredComplete = data.campaign.questions.every((q) => !q.required || answers[q.id]);

  return (
    <div className="patient-shell">
      <div className="patient-header">
        <div className="patient-logo"><div className="brand-mark">C</div><strong>CareFlow AI</strong></div>
        <span className="secure-label">Secure follow-up</span>
      </div>
      <main className="patient-main">
        <section className="patient-hero">
          <span className="eyebrow">POST-DISCHARGE CHECK-IN</span>
          <h1>{data.campaign.name}</h1>
          <p>Hello {data.patient.name}. Please answer the questions below. You can type or record a voice response for each question.</p>
        </section>

        {submitted ? (
          <div className="submitted-card">
            <div className="submitted-icon">✓</div>
            <div><h2>Follow-up submitted</h2><p>{msg}</p><small>Your responses have been received. You may safely close this page.</small></div>
          </div>
        ) : (
          <>
            <div className="patient-progress"><span>{Object.keys(answers).length} of {data.campaign.questions.length} answered</span><div><i style={{ width: `${Math.min(100, (Object.keys(answers).length / data.campaign.questions.length) * 100)}%` }} /></div></div>
            <div className="patient-questions">
              {data.campaign.questions.map((q, index) => (
                <Question
                  key={q.id}
                  q={q}
                  index={index}
                  answer={answers[q.id]}
                  onText={async (t) => { try { await saveText(q.id, t); } catch (e) { setMsg(e.response?.data?.message || "Could not save answer"); } }}
                  onRecord={() => startRecording(q.id)}
                  onStop={stopRecording}
                  recording={recordingId === q.id}
                  recordingElapsed={recordingElapsed}
                  disabled={busy && recordingId !== q.id}
                  token={token}
                />
              ))}
            </div>
            {msg && !submitted && <div className="alert error patient-alert">{msg}</div>}
            <button className="patient-submit" disabled={busy || !requiredComplete || !!recordingId} onClick={submit}>{busy ? "Saving…" : "Submit follow-up"}</button>
            {!requiredComplete && <p className="submit-hint">Please answer every required question before submitting.</p>}
          </>
        )}
      </main>
    </div>
  );
}

function Question({ q, index, onText, onRecord, onStop, answer, recording, recordingElapsed, disabled, token }) {
  const [text, setText] = useState(answer?.text || "");
  const audioUrl = answer?.audio?.assetId ? `${import.meta.env.VITE_API_URL || "http://localhost:4000/api"}/patient/outreach/${token}/response/${q.id}/audio` : null;
  const hasAnswer = Boolean(answer?.text?.trim() || answer?.audio?.assetId);

  useEffect(() => { setText(answer?.text || ""); }, [answer?.text]);

  const minutes = String(Math.floor(recordingElapsed / 60)).padStart(2, "0");
  const seconds = String(recordingElapsed % 60).padStart(2, "0");

  return (
    <article className={`question-card ${recording ? "is-recording" : ""} ${hasAnswer ? "has-answer" : ""}`}>
      <div className="question-number">{String(index + 1).padStart(2, "0")}</div>
      <div className="question-content">
        <div className="question-title-row"><h3>{q.text}</h3>{q.required && <span className="required">Required</span>}</div>
        {!hasAnswer && !recording && <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer…" disabled={disabled} />}

        {recording && (
          <div className="recording-panel">
            <div className="recording-live"><span className="recording-dot" /> Recording answer <strong>{minutes}:{seconds}</strong></div>
            <div className="waveform">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 17) % 28)}px` }} />)}</div>
            <button className="stop-button" onClick={onStop}>■ Stop recording</button>
            <p>Only this question is recording. Your other answers are unchanged.</p>
          </div>
        )}

        {hasAnswer && !recording && (
          <div className="saved-answer">
            <div className="saved-line"><span className="saved-check">✓</span><div><strong>Answer recorded</strong><small>{answer?.responseType === "TEXT" ? "Text response saved" : "Voice response saved"}</small></div></div>
            {answer?.transcript && <p className="transcript-preview">{answer.transcript}</p>}
            {audioUrl && <audio controls preload="none" src={audioUrl} />}
          </div>
        )}

        {!recording && !hasAnswer && (
          <div className="question-actions">
            <button disabled={!text.trim() || disabled} onClick={() => onText(text)}>Save text</button>
            <span>or</span>
            <button className="secondary" disabled={disabled} onClick={onRecord}>🎙 Record voice</button>
          </div>
        )}

        {hasAnswer && !recording && (
          <div className="question-actions saved-actions">
            <button className="secondary" disabled={disabled} onClick={onRecord}>↻ Re-record voice</button>
            <span className="saved-label">Saved</span>
          </div>
        )}
      </div>
    </article>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/patient/followup/:token" element={<PatientFollowup />} />
      <Route path="/hospitals" element={<ProtectedRoute roles={[ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN]}><Hospitals /></ProtectedRoute>} />
      <Route path="/knowledge" element={<ProtectedRoute roles={[ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN]}><Knowledge /></ProtectedRoute>} />
      <Route path="/campaigns" element={<ProtectedRoute roles={[ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CAMPAIGN_MANAGER]}><Campaigns /></ProtectedRoute>} />
      <Route path="/queue" element={<ProtectedRoute roles={[ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CAMPAIGN_MANAGER]}><Queue /></ProtectedRoute>} />
      <Route path="/simulation" element={<ProtectedRoute roles={[ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CAMPAIGN_MANAGER]}><Simulation /></ProtectedRoute>} />
      <Route path="/reviews" element={<ProtectedRoute roles={[ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CLINICAL_REVIEWER]}><Reviews /></ProtectedRoute>} />
      <Route path="/" element={<ProtectedRoute roles={[ROLE.PLATFORM_ADMIN, ROLE.HOSPITAL_ADMIN, ROLE.CAMPAIGN_MANAGER]}><Dashboard /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter><App /></BrowserRouter>,
);
