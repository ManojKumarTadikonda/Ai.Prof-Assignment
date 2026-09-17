import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useNavigate,
  useParams,
  Routes,
  Route,
  Link,
  Navigate,
} from "react-router-dom";
import { api } from "./lib/api";
import "./styles.css";

const user = () => JSON.parse(localStorage.getItem("user") || "null");
const canManage = () =>
  ["PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER"].includes(
    user()?.role,
  );

function Login() {
  const [email, setEmail] = useState("manager@hospital-a.local"),
    [password, setPassword] = useState("demo123"),
    [err, setErr] = useState("");
  const nav = useNavigate();
  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const r = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", r.data.token);
      localStorage.setItem("user", JSON.stringify(r.data.user));
      nav("/");
    } catch (e) {
      setErr(e.response?.data?.message || "Login failed");
    }
  }
  return (
    <div className="center">
      <form className="card form" onSubmit={submit}>
        <h1>CareFlow AI</h1>
        <p>Hospital outreach operations</p>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button>Login</button>
        {err && <div className="error">{err}</div>}
        <small>Demo password: demo123</small>
      </form>
    </div>
  );
}

function Layout({ children }) {
  const u = user(),
    nav = useNavigate();
  if (!u) return <Navigate to="/login" replace />;
  return (
    <div>
      <header>
        <b>CareFlow AI</b>
        <nav>
          <Link to="/">Dashboard</Link>
          {canManage() && <Link to="/campaigns">Campaigns</Link>}
          <Link to="/queue">Outreach Queue</Link>
          <Link to="/reviews">Clinical Review</Link>
          <button
            className="ghost"
            onClick={() => {
              localStorage.clear();
              nav("/login");
            }}
          >
            Logout
          </button>
        </nav>
      </header>
      <div className="userbar">
        {u.name} · {u.role.replaceAll("_", " ")}
      </div>
      <main>{children}</main>
    </div>
  );
}

function Dashboard() {
  const [d, setD] = useState(null),
    [err, setErr] = useState("");
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
  return (
    <Layout>
      <h2>Operations Dashboard</h2>
      {err && <div className="error">{err}</div>}
      <div className="grid">
        {d &&
          Object.entries(d).map(([k, v]) => (
            <div className="metric" key={k}>
              <span>{k.replaceAll(/([A-Z])/g, " $1")}</span>
              <strong>{v}</strong>
            </div>
          ))}
      </div>
      <div className="card">
        <h3>End-to-end flow</h3>
        <p>
          Eligibility → prioritized outreach → secure email → patient text/voice
          questionnaire → responses saved → immediate patient confirmation →
          background Gemini assessment → protocol validation → consensus →
          controlled EHR update or clinical escalation.
        </p>
        <h3>AI monitoring</h3>
        <p>
          <b>Processing:</b> {d?.aiProcessing ?? 0} &nbsp; <b>Human review:</b>{" "}
          {d?.aiHumanReview ?? 0} &nbsp; <b>Failed:</b> {d?.aiFailed ?? 0}
        </p>
      </div>
    </Layout>
  );
}

function Campaigns() {
  const [rows, setRows] = useState([]),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState("");
  const load = () =>
    api
      .get("/campaigns")
      .then((r) => setRows(r.data))
      .catch((e) =>
        setMsg(e.response?.data?.message || "Could not load campaigns"),
      );
  useEffect(() => {
    load();
  }, []);
  async function run(id) {
    setBusy(id);
    setMsg("");
    try {
      const r = await api.post(`/campaigns/${id}/eligibility/run`);
      setMsg(
        `Eligibility complete: ${r.data.eligible} eligible, ${r.data.tasksCreated} new queue tasks.`,
      );
    } catch (e) {
      setMsg(e.response?.data?.message || "Eligibility failed");
    } finally {
      setBusy("");
      load();
    }
  }
  return (
    <Layout>
      <div className="row">
        <h2>Campaigns</h2>
      </div>
      {msg && <div className="success">{msg}</div>}
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th>Follow-up window</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c._id}>
              <td>{c.name}</td>
              <td>{c.status}</td>
              <td>{c.followUpDays} days</td>
              <td>
                <button disabled={!!busy} onClick={() => run(c._id)}>
                  {busy === c._id ? "Running..." : "Run Eligibility"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}

function Queue() {
  const [rows, setRows] = useState([]),
    [msg, setMsg] = useState("");
  async function load() {
    try {
      setRows((await api.get("/queue")).data);
    } catch (e) {
      setMsg(e.response?.data?.message || "Could not load queue");
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  async function process() {
    setMsg("");
    try {
      const r = await api.post("/queue/process");
      setMsg(`${r.data.sent} outreach email(s) sent.`);
      await load();
    } catch (e) {
      setMsg(e.response?.data?.message || "Queue processing failed");
    }
  }
  return (
    <Layout>
      <div className="row">
        <h2>Outreach Queue</h2>
        {canManage() && <button onClick={process}>Process Queue</button>}
      </div>
      {msg && <div className="success">{msg}</div>}
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Task</th>
            <th>AI Processing</th>
            <th>Classification</th>
            <th>Priority</th>
            <th>Attempts</th>
            <th>Deadline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x._id}>
              <td>{x.patientId?.name}</td>
              <td>{x.status}</td>
              <td>
                <Status value={x.aiProcessingStatus || "NOT_STARTED"} />
                {x.aiProcessingError && (
                  <small className="error">{x.aiProcessingError}</small>
                )}
              </td>
              <td>
                {x.latestAIAssessment?.classification ? (
                  <b>
                    {String(x.latestAIAssessment.classification).toUpperCase()}
                  </b>
                ) : x.aiProcessingStatus === "HUMAN_REVIEW" ? (
                  "Human review required"
                ) : (
                  "—"
                )}
              </td>
              <td>{x.priorityScore}</td>
              <td>{x.attempts}</td>
              <td>{x.deadline && new Date(x.deadline).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
function Status({ value }) {
  return (
    <span className={`status ${String(value).toLowerCase()}`}>
      {String(value).replaceAll("_", " ")}
    </span>
  );
}

function Reviews() {
  const [rows, setRows] = useState([]),
    [msg, setMsg] = useState("");
  const load = () =>
    api
      .get("/reviews")
      .then((r) => setRows(r.data))
      .catch((e) =>
        setMsg(e.response?.data?.message || "Could not load reviews"),
      );
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  async function resolve(id) {
    const resolution = prompt("Reviewer resolution");
    if (!resolution) return;
    try {
      await api.post("/reviews/" + id + "/resolve", {
        resolution,
        updateEhr: true,
      });
      setMsg("Escalation resolved and mock EHR updated.");
      load();
    } catch (e) {
      setMsg(e.response?.data?.message || "Could not resolve");
    }
  }
  return (
    <Layout>
      <h2>Clinical Review</h2>
      {msg && <div className="success">{msg}</div>}
      {!rows.length && (
        <div className="card">No open clinical escalations.</div>
      )}
      {rows.map((x) => (
        <div className="card" key={x._id}>
          <div className="row">
            <b>{x.patientId?.name}</b>
            <Status value={x.status} />
          </div>
          <p>
            <b>Escalation reason:</b> {x.reason}
          </p>
          <p>
            <b>Priority:</b> {x.priority}
          </p>
          <div className="ai-box">
            <h3>AI Processing</h3>
            {x.aiAssessments?.length ? (
              x.aiAssessments.map((a) => (
                <div key={a._id} className="assessment">
                  <span>Assessment {a.assessmentNo}</span>
                  <b>{String(a.classification).toUpperCase()}</b>
                  <span>Uncertainty: {a.uncertainty}</span>
                  <span>
                    Human review: {a.requiresHumanReview ? "YES" : "NO"}
                  </span>
                  {a.evidence?.length > 0 && (
                    <small>Evidence: {a.evidence.join("; ")}</small>
                  )}
                </div>
              ))
            ) : (
              <p>No AI assessment record yet.</p>
            )}
          </div>
          {x.status !== "RESOLVED" && x.status !== "CLOSED" && (
            <button onClick={() => resolve(x._id)}>Resolve + update EHR</button>
          )}
        </div>
      ))}
    </Layout>
  );
}

function PatientFollowup() {
  const { token } = useParams();
  const [data, setData] = useState(null),
    [answers, setAnswers] = useState({}),
    [recording, setRecording] = useState(null),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [msg, setMsg] = useState("");
  useEffect(() => {
    api
      .get("/patient/outreach/" + token)
      .then((r) => {
        setData(r.data);
        setAnswers(
          Object.fromEntries(
            (r.data.answeredQuestionIds || []).map((id) => [id, true]),
          ),
        );
      })
      .catch((e) => setMsg(e.response?.data?.message || "Invalid link"));
  }, [token]);
  async function saveText(qid, text) {
    const fd = new FormData();
    fd.append("questionId", qid);
    fd.append("text", text);
    await api.post("/patient/outreach/" + token + "/response", fd);
  }
  async function record(qid) {
    if (recording) {
      recording.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

    const mimeType = mimeTypes.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      const fd = new FormData();
      fd.append("questionId", qid);
      fd.append("audio", blob, "answer.webm");
      setBusy(true);
      try {
        await api.post("/patient/outreach/" + token + "/response", fd);
        setAnswers((a) => ({ ...a, [qid]: true }));
      } catch (e) {
        setMsg(e.response?.data?.message || "Could not save voice answer");
      } finally {
        setBusy(false);
        setRecording(null);
      }
    };
    mr.start();
    setRecording(mr);
  }
  async function submit() {
    setBusy(true);
    try {
      const r = await api.post("/patient/outreach/" + token + "/submit");
      setSubmitted(true);
      setMsg(
        r.data.message ||
          "Follow-up submitted successfully. Your responses have been received.",
      );
    } catch (e) {
      setMsg(e.response?.data?.message || "Could not submit");
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="center">
        <div className="card">{msg || "Loading..."}</div>
      </div>
    );
  return (
    <div className="patient">
      <div className="card">
        <h1>{data.campaign.name}</h1>
        <p>
          Hello {data.patient.name}. Please answer every required question. Each
          question can be answered by text OR voice.
        </p>
        {submitted ? (
          <div className="success large">
            ✓ Follow-up submitted successfully.
            <br />
            <small>
              Your responses have been received. You may close this page.
            </small>
          </div>
        ) : (
          <>
            {data.campaign.questions.map((q) => (
              <Question
                key={q.id}
                q={q}
                answered={answers[q.id]}
                onText={async (t) => {
                  try {
                    await saveText(q.id, t);
                    setAnswers((a) => ({ ...a, [q.id]: true }));
                  } catch (e) {
                    setMsg(
                      e.response?.data?.message || "Could not save answer",
                    );
                  }
                }}
                onRecord={() => record(q.id)}
                recording={recording}
              />
            ))}
            <button
              disabled={
                busy ||
                data.campaign.questions.some(
                  (q) => q.required && !answers[q.id],
                )
              }
              onClick={submit}
            >
              {busy ? "Saving..." : "Submit follow-up"}
            </button>
          </>
        )}
        {msg && !submitted && <div className="error">{msg}</div>}
      </div>
    </div>
  );
}
function Question({ q, onText, onRecord, answered, recording }) {
  const [text, setText] = useState("");
  return (
    <div className="question">
      <b>{q.text}</b>
      <textarea
        disabled={answered}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your answer"
      />
      <button disabled={!text.trim() || answered} onClick={() => onText(text)}>
        Save text
      </button>
      <button className="secondary" disabled={answered} onClick={onRecord}>
        {recording ? "Stop recording" : "🎤 Record voice"}
      </button>
      {answered && <small className="success">✓ Answer saved</small>}
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/patient/followup/:token" element={<PatientFollowup />} />
      <Route path="/campaigns" element={<Campaigns />} />
      <Route path="/queue" element={<Queue />} />
      <Route path="/reviews" element={<Reviews />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
