import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,useNavigate,useParams,Routes,Route,Link,useLocation,Navigate} from 'react-router-dom';
import {api} from './lib/api';
import './styles.css';

const roles={
  PLATFORM_ADMIN:'Platform Admin',
  HOSPITAL_ADMIN:'Hospital Admin',
  CAMPAIGN_MANAGER:'Campaign Manager',
  CLINICAL_REVIEWER:'Clinical Reviewer'
};
const canQueue=r=>['PLATFORM_ADMIN','HOSPITAL_ADMIN','CAMPAIGN_MANAGER'].includes(r);
const canPatients=r=>['PLATFORM_ADMIN','HOSPITAL_ADMIN'].includes(r);
const canCampaigns=r=>['PLATFORM_ADMIN','HOSPITAL_ADMIN','CAMPAIGN_MANAGER'].includes(r);
const canReviews=r=>['PLATFORM_ADMIN','HOSPITAL_ADMIN','CLINICAL_REVIEWER'].includes(r);
function currentUser(){try{return JSON.parse(localStorage.getItem('user')||'null')}catch{return null}}
function fmt(v){return v?new Date(v).toLocaleString():'—'}
function Badge({children,tone=''}){return <span className={`badge ${tone}`}>{children}</span>}

function Login(){
  const [email,setEmail]=useState('admin@hospital-a.local'),[password,setPassword]=useState('demo123'),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const nav=useNavigate();
  async function submit(e){e.preventDefault();setErr('');setBusy(true);try{const r=await api.post('/auth/login',{email,password});localStorage.setItem('token',r.data.token);localStorage.setItem('user',JSON.stringify(r.data.user));nav('/');}catch(e){setErr(e.response?.data?.message||'Login failed')}finally{setBusy(false)}}
  return <div className="login-page"><div className="login-shell"><div className="brand-panel"><div className="logo">CF</div><h1>CareFlow AI</h1><p>Multi-hospital post-discharge outreach, queue operations and human clinical review.</p><div className="login-points"><span>✓ Tenant-isolated hospital operations</span><span>✓ Capacity-aware outreach queue</span><span>✓ Gemini triage + human escalation</span></div></div><form className="card login-card" onSubmit={submit}><h2>Sign in</h2><p className="muted">Use one of the seeded staff accounts.</p><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@hospital.com" autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button>{err&&<div className="error">{err}</div>}<div className="demo-accounts"><b>Demo password:</b> demo123<br/><span>platform@careflow.local · admin@hospital-a.local · manager@hospital-a.local · reviewer@hospital-a.local · admin@hospital-b.local</span></div></form></div></div>
}

function Protected({children}){return localStorage.getItem('token')?<>{children}</>:<Navigate to="/login" replace/>}
function Layout({children}){
  const user=currentUser();const nav=useNavigate();const loc=useLocation();
  const items=[
    ['Dashboard','/'],
    ...(canPatients(user?.role)?[['Patients','/patients']]:[]),
    ...(canCampaigns(user?.role)?[['Campaigns','/campaigns']]:[]),
    ...(canQueue(user?.role)?[['Outreach Queue','/queue']]:[]),
    ...(canReviews(user?.role)?[['Clinical Review','/reviews']]:[]),
  ];
  return <div className="app-shell"><aside><div className="side-brand"><div className="logo small">CF</div><div><b>CareFlow</b><small>AI Operations</small></div></div><nav className="side-nav">{items.map(([label,path])=><Link className={loc.pathname===path?'active':''} key={path} to={path}>{label}</Link>)}</nav><div className="side-user"><div className="avatar">{(user?.name||'U').slice(0,1)}</div><div><b>{user?.name}</b><small>{roles[user?.role]||user?.role}</small></div></div><button className="logout" onClick={()=>{localStorage.clear();nav('/login')}}>Log out</button></aside><main className="content"><div className="mobile-top"><b>CareFlow AI</b><button className="ghost" onClick={()=>{localStorage.clear();nav('/login')}}>Logout</button></div>{children}</main></div>
}

function PageHeader({title,subtitle,actions}){return <div className="page-header"><div><h1>{title}</h1>{subtitle&&<p className="muted">{subtitle}</p>}</div><div className="actions">{actions}</div></div>}
function Metric({label,value,detail}){return <div className="metric"><span>{label}</span><strong>{value??'—'}</strong>{detail&&<small>{detail}</small>}</div>}

function Dashboard(){
 const user=currentUser();const [d,setD]=useState(null),[hospitals,setHospitals]=useState([]),[loading,setLoading]=useState(true);
 async function load(){setLoading(true);try{const [s,h]=await Promise.all([api.get('/dashboard/summary'),api.get('/hospitals')]);setD(s.data);setHospitals(h.data)}finally{setLoading(false)}}useEffect(()=>{load()},[]);
 return <Layout><PageHeader title="Operations Dashboard" subtitle={`Welcome back, ${user?.name}. ${roles[user?.role]||''}`} actions={<Link className="button" to={canQueue(user?.role)?'/queue':'/reviews'}>{canQueue(user?.role)?'Open outreach queue':'Open clinical review'}</Link>}/>
 {loading?<div className="card loading">Loading dashboard…</div>:<><div className="metrics"><Metric label="Patients" value={d?.patients}/><Metric label="Queued / pending" value={d?.pending}/><Metric label="Active outreach" value={d?.active}/><Metric label="Completed" value={d?.completed}/><Metric label="Open escalations" value={d?.openEscalations}/><Metric label="Mock EHR updates" value={d?.ehrUpdates}/></div>
 <div className="two-col"><div className="card"><div className="card-title"><h3>How the platform works</h3><Badge>End-to-end</Badge></div><div className="flow"><span>Eligibility</span><i>→</i><span>Priority queue</span><i>→</i><span>Secure email</span><i>→</i><span>Text / voice</span><i>→</i><span>AI triage</span><i>→</i><span>Human review / EHR</span></div><p className="muted">Run eligibility first to create outreach tasks. Then process the queue to send secure patient invitations.</p></div><div className="card"><div className="card-title"><h3>{user?.role==='PLATFORM_ADMIN'?'Hospital tenants':'Hospital'}</h3><Badge>{hospitals.length}</Badge></div>{hospitals.map(h=><div className="hospital-row" key={h._id}><div><b>{h.name}</b><small>{h.code} · capacity {h.outboundCapacity}</small></div><Badge tone={h.status==='ACTIVE'?'ok':''}>{h.status}</Badge></div>)}</div></div></>}
 </Layout>
}

function Patients(){const [rows,setRows]=useState([]),[busy,setBusy]=useState(true);const load=()=>api.get('/patients').then(r=>setRows(r.data)).finally(()=>setBusy(false));useEffect(()=>{load()},[]);return <Layout><PageHeader title="Patients" subtitle="Hospital-scoped discharge and communication records"/><div className="card table-card">{busy?<div className="loading">Loading patients…</div>:rows.length===0?<Empty text="No patients found. Run the seed or add a patient."/>:<table><thead><tr><th>Patient</th><th>Email</th><th>Discharge</th><th>Risk</th><th>Consent</th></tr></thead><tbody>{rows.map(p=><tr key={p._id}><td><b>{p.name}</b><small>{p.externalId}</small></td><td>{p.email}</td><td>{fmt(p.dischargeDate)}</td><td><Badge tone={p.risk==='urgent'?'danger':p.risk==='concerning'?'warn':'ok'}>{p.risk}</Badge></td><td>{p.communicationConsent?'Yes':'No'}</td></tr>)}</tbody></table>}</div></Layout>}
function Empty({text}){return <div className="empty">{text}</div>}

function Campaigns(){
 const user=currentUser();const [rows,setRows]=useState([]),[busy,setBusy]=useState(true),[action,setAction]=useState('');
 async function load(){setBusy(true);try{setRows((await api.get('/campaigns')).data)}finally{setBusy(false)}}useEffect(()=>{load()},[]);
 async function eligibility(id){setAction(id);try{const r=await api.post(`/campaigns/${id}/eligibility/run`);alert(`Eligibility complete: ${r.data.eligible} eligible, ${r.data.tasksCreated} new queue tasks.`);await load()}catch(e){alert(e.response?.data?.message||'Eligibility failed')}finally{setAction('')}}
 return <Layout><PageHeader title="Campaigns" subtitle="Configure and launch hospital-specific post-discharge outreach" actions={canQueue(user?.role)&&<Link className="button secondary-btn" to="/queue">View queue</Link>}/>{busy?<div className="card loading">Loading campaigns…</div>:rows.length===0?<Empty text="No campaigns found."/>:<div className="campaign-grid">{rows.map(c=><div className="card campaign-card" key={c._id}><div className="campaign-head"><div><h3>{c.name}</h3><small>{c.followUpDays}-day follow-up window · priority {c.priority}</small></div><Badge tone={c.status==='RUNNING'?'ok':''}>{c.status}</Badge></div><div className="question-count">{c.questions?.length||0} required questions · text + voice</div><div className="campaign-actions">{canQueue(user?.role)&&<button onClick={()=>eligibility(c._id)} disabled={action===c._id}>{action===c._id?'Running…':'Run Eligibility'}</button>}<Link className="button outline" to="/queue">Open Queue</Link></div></div>)}</div>}</Layout>
}

function Queue(){
 const user=currentUser();const [rows,setRows]=useState([]),[busy,setBusy]=useState(true),[processing,setProcessing]=useState(false),[last,setLast]=useState('');
 async function load(){setBusy(true);try{setRows((await api.get('/queue')).data)}catch(e){setLast(e.response?.data?.message||'Unable to load queue')}finally{setBusy(false)}}useEffect(()=>{load()},[]);
 async function process(){setProcessing(true);setLast('');try{const r=await api.post('/queue/process');setLast(`${r.data.sent||0} outreach invitation(s) processed. Refreshing queue…`);await load()}catch(e){setLast(e.response?.data?.message||'Queue processing failed')}finally{setProcessing(false)}}
 const counts=useMemo(()=>rows.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),[rows]);
 return <Layout><PageHeader title="Outreach Queue" subtitle="Prioritized, tenant-isolated outreach tasks with controlled capacity" actions={<><button className="secondary-btn" onClick={load}>Refresh</button><button onClick={process} disabled={processing}>{processing?'Processing…':'Start Queue'}</button></>}/>{last&&<div className="notice">{last}</div>}<div className="queue-stats"><Metric label="Total tasks" value={rows.length}/><Metric label="Pending" value={counts.PENDING||0}/><Metric label="Scheduled" value={counts.SCHEDULED||0}/><Metric label="Retries" value={counts.RETRY_SCHEDULED||0}/><Metric label="Escalated" value={counts.ESCALATED||0}/><Metric label="Manual follow-up" value={counts.MANUAL_FOLLOW_UP||0}/></div><div className="card table-card"><div className="card-title"><h3>Priority order</h3><span className="muted">Highest priority first</span></div>{busy?<div className="loading">Loading queue…</div>:rows.length===0?<Empty text="Queue is empty. Open Campaigns → Run Eligibility first. That creates the outreach tasks."/>:<table><thead><tr><th>Patient</th><th>Campaign</th><th>Status</th><th>Priority</th><th>Attempts</th><th>Deadline</th></tr></thead><tbody>{rows.map(x=><tr key={x._id}><td><b>{x.patientId?.name||'—'}</b><small>{x.patientId?.email||''}</small></td><td>{x.campaignId?.name||'—'}</td><td><Badge tone={x.status==='ESCALATED'?'danger':x.status==='COMPLETED'?'ok':x.status==='RETRY_SCHEDULED'?'warn':''}>{x.status}</Badge></td><td><b>{x.priorityScore}</b></td><td>{x.attempts}</td><td>{fmt(x.deadline)}</td></tr>)}</tbody></table>}</div></Layout>
}

function Reviews(){
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(true),[selected,setSelected]=useState(null),[resolution,setResolution]=useState(''),[saving,setSaving]=useState(false);
 async function load(){setBusy(true);try{setRows((await api.get('/reviews')).data)}finally{setBusy(false)}}useEffect(()=>{load()},[]);
 async function resolve(){if(!selected||!resolution.trim())return;setSaving(true);try{await api.post(`/reviews/${selected._id}/resolve`,{resolution,updateEhr:true});setSelected(null);setResolution('');await load()}catch(e){alert(e.response?.data?.message||'Could not resolve')}finally{setSaving(false)}}
 return <Layout><PageHeader title="Clinical Review" subtitle="Human-in-the-loop review for escalated or uncertain outreach cases" actions={<button className="secondary-btn" onClick={load}>Refresh</button>}/>{busy?<div className="card loading">Loading escalations…</div>:rows.length===0?<Empty text="No clinical escalations yet. Complete a concerning/urgent/ambiguous patient follow-up to create one."/>:<div className="review-grid">{rows.map(x=><div className="card review-card" key={x._id}><div className="campaign-head"><div><h3>{x.patientId?.name}</h3><small>{x.patientId?.externalId} · {x.patientId?.email}</small></div><Badge tone={x.status==='RESOLVED'?'ok':'danger'}>{x.status}</Badge></div><p><b>Reason:</b> {x.reason}</p><p><b>Priority:</b> {x.priority}</p>{x.resolution&&<p><b>Resolution:</b> {x.resolution}</p>}{x.status!=='RESOLVED'&&<button onClick={()=>{setSelected(x);setResolution('')}}>Review case</button>}</div>)}</div>}{selected&&<div className="modal-backdrop"><div className="modal card"><div className="card-title"><h3>Clinical review</h3><button className="icon-btn" onClick={()=>setSelected(null)}>×</button></div><p><b>{selected.patientId?.name}</b></p><p className="muted">{selected.reason}</p><label>Human resolution / follow-up action<textarea value={resolution} onChange={e=>setResolution(e.target.value)} placeholder="Document what the care team should do…"/></label><div className="modal-actions"><button className="secondary-btn" onClick={()=>setSelected(null)}>Cancel</button><button onClick={resolve} disabled={saving||!resolution.trim()}>{saving?'Saving…':'Resolve + update EHR'}</button></div></div></div>}</Layout>
}

function PatientFollowup(){
 const {token}=useParams();const [data,setData]=useState(null),[answers,setAnswers]=useState({}),[recording,setRecording]=useState(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 useEffect(()=>{api.get('/patient/outreach/'+token).then(r=>{setData(r.data);setAnswers(Object.fromEntries((r.data.answeredQuestionIds||[]).map(id=>[id,true])))}).catch(e=>setMsg(e.response?.data?.message||'Invalid link'))},[token]);
 async function saveText(qid,text){const fd=new FormData();fd.append('questionId',qid);fd.append('text',text);await api.post('/patient/outreach/'+token+'/response',fd);setAnswers(a=>({...a,[qid]:true}))}
 async function record(qid){if(recording){recording.stop();return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const mr=new MediaRecorder(stream);const chunks=[];mr.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};mr.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:mr.mimeType||'audio/webm'});const fd=new FormData();fd.append('questionId',qid);fd.append('audio',blob,'answer.webm');setBusy(true);try{await api.post('/patient/outreach/'+token+'/response',fd);setAnswers(a=>({...a,[qid]:true}));}catch(e){setMsg(e.response?.data?.message||'Voice upload failed')}finally{setBusy(false);setRecording(null)}};mr.start();setRecording(mr)}catch(e){setMsg('Microphone permission is required for voice answers.')}}
 async function submit(){setBusy(true);try{const r=await api.post('/patient/outreach/'+token+'/submit');setMsg(r.data.status==='HUMAN_REVIEW'?'Thank you. Your responses were sent for clinical review.':'Thank you. Your follow-up is complete.');}catch(e){setMsg(e.response?.data?.message||'Could not submit')}finally{setBusy(false)}}
 if(!data)return <div className="patient-page"><div className="card patient-card">{msg||'Loading secure follow-up…'}</div></div>;
 const missing=data.campaign.questions.filter(q=>q.required&&!answers[q.id]);
 return <div className="patient-page"><div className="patient-card"><div className="patient-brand"><div className="logo">CF</div><div><b>CareFlow AI</b><small>Secure patient follow-up</small></div></div><h1>{data.campaign.name}</h1><p>Hello <b>{data.patient.name}</b>. Please answer every required question. For each question, choose <b>text or voice</b>.</p><div className="expiry">Secure link expires {fmt(data.expiresAt)}</div>{data.campaign.questions.map(q=><Question key={q.id} q={q} answered={answers[q.id]} onText={t=>saveText(q.id,t)} onRecord={()=>record(q.id)} recording={recording} disabled={busy}/>) }<button className="submit-patient" disabled={busy||missing.length>0} onClick={submit}>{busy?'Processing…':missing.length?`${missing.length} answer(s) remaining`:'Submit follow-up'}</button>{msg&&<div className="notice success-box">{msg}</div>}</div></div>
}
function Question({q,onText,onRecord,answered,recording,disabled}){const [text,setText]=useState('');return <div className="question"><div className="question-title"><b>{q.text}</b>{q.required&&<span>* Required</span>}</div>{answered?<div className="answered">✓ Answer saved</div>:<><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Type your answer here…" disabled={disabled}/><div><button disabled={disabled||!text.trim()} onClick={()=>onText(text)}>Save text</button><button className="secondary-btn" disabled={disabled} onClick={onRecord}>{recording?'Stop recording':'🎤 Record voice'}</button></div></>}</div>}

function App(){return <Routes><Route path="/login" element={<Login/>}/><Route path="/patient/followup/:token" element={<PatientFollowup/>}/><Route path="/" element={<Protected><Dashboard/></Protected>}/><Route path="/patients" element={<Protected><Patients/></Protected>}/><Route path="/campaigns" element={<Protected><Campaigns/></Protected>}/><Route path="/queue" element={<Protected><Queue/></Protected>}/><Route path="/reviews" element={<Protected><Reviews/></Protected>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
