import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

const ADMIN_EMAIL = "twcoad@gmail.com";
const FB = "'Space Grotesk',sans-serif";
const FM = "'Share Tech Mono',monospace";
const FONT_URL = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

function startOf(unit) {
  const d = new Date();
  if (unit === "day")   { d.setHours(0,0,0,0); }
  if (unit === "week")  { d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); }
  if (unit === "month") { d.setHours(0,0,0,0); d.setDate(1); }
  return d.toISOString();
}

function last30Days() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0,10));
  }
  return days;
}

// ── Simple SVG bar chart ──────────────────────────────────────────────────────

function BarChart({ data }) {
  const max = Math.max(...data.map(d => d.count), 1);
  const H = 160;
  const barW = 100 / data.length;

  return (
    <div style={{ width:"100%", overflowX:"auto" }}>
      <div style={{ minWidth: 600, padding:"0 4px" }}>
        <svg viewBox={`0 0 100 ${H + 24}`} preserveAspectRatio="none"
          style={{ width:"100%", height: H + 24, display:"block" }}>
          {data.map((d, i) => {
            const barH = (d.count / max) * H;
            const x = i * barW;
            const y = H - barH;
            const isToday = d.date === new Date().toISOString().slice(0,10);
            return (
              <g key={d.date}>
                <rect x={x + barW * 0.1} y={y} width={barW * 0.8} height={barH}
                  fill={isToday ? "#eb0000" : "rgba(235,0,0,0.45)"} rx="0.5"/>
                {d.count > 0 && (
                  <text x={x + barW / 2} y={y - 2} textAnchor="middle"
                    fontSize="3.5" fill="rgba(255,255,255,0.7)" fontFamily={FB}>{d.count}</text>
                )}
                {(i === 0 || i === 14 || i === 29 || isToday) && (
                  <text x={x + barW / 2} y={H + 10} textAnchor="middle"
                    fontSize="3" fill="rgba(255,255,255,0.4)" fontFamily={FB}>
                    {d.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, loading }) {
  return (
    <div style={{ background:"#111", border:"1px solid rgba(255,255,255,0.08)",
      borderRadius:"0.5rem", padding:"20px 24px" }}>
      <div style={{ fontFamily:FB, fontSize:11, fontWeight:"600", letterSpacing:"0.08em",
        textTransform:"uppercase", color:"rgba(255,255,255,0.4)", marginBottom:8 }}>{label}</div>
      <div style={{ fontFamily:FM, fontSize:32, fontWeight:"700", color:"#ffffff" }}>
        {loading ? "—" : value}
      </div>
    </div>
  );
}

// ── User row ──────────────────────────────────────────────────────────────────

function UserRow({ user, jobs }) {
  const [expanded, setExpanded] = useState(false);
  const userJobs = jobs.filter(j => j.user_id === user.id)
    .sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

  return (
    <>
      <tr onClick={() => setExpanded(e => !e)}
        style={{ cursor:"pointer", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <td style={td}>{user.email}</td>
        <td style={{...td, textAlign:"center"}}>{userJobs.length}</td>
        <td style={td}>{fmtDate(userJobs[0]?.created_at)}</td>
        <td style={td}>{fmtDate(user.created_at)}</td>
        <td style={{...td, textAlign:"center", color:"rgba(255,255,255,0.4)"}}>
          {expanded ? "▲" : "▼"}
        </td>
      </tr>
      {expanded && userJobs.length > 0 && userJobs.map(j => (
        <tr key={j.id} style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
          <td colSpan={5} style={{ padding:"8px 16px 8px 32px" }}>
            <div style={{ display:"flex", gap:24, flexWrap:"wrap",
              fontFamily:FB, fontSize:12, color:"rgba(255,255,255,0.6)" }}>
              <span style={{ fontFamily:FM, color:"#eb0000", fontSize:13 }}>
                {j.vehicle?.reg || "No REG"}
              </span>
              <span>{j.customer?.company || j.customer?.name || "No customer"}</span>
              <span>{fmtDate(j.created_at)}</span>
              {j.config_name && <span style={{ color:"rgba(255,255,255,0.35)" }}>{j.config_name}</span>}
            </div>
          </td>
        </tr>
      ))}
      {expanded && userJobs.length === 0 && (
        <tr style={{ background:"rgba(255,255,255,0.03)" }}>
          <td colSpan={5} style={{ padding:"8px 16px 8px 32px", fontFamily:FB,
            fontSize:12, color:"rgba(255,255,255,0.3)" }}>No jobs</td>
        </tr>
      )}
    </>
  );
}

const th = { padding:"10px 16px", textAlign:"left", fontFamily:FB, fontSize:11, fontWeight:"600",
  letterSpacing:"0.06em", textTransform:"uppercase", color:"rgba(255,255,255,0.4)",
  borderBottom:"1px solid rgba(255,255,255,0.1)", whiteSpace:"nowrap" };
const td = { padding:"12px 16px", fontFamily:FB, fontSize:13, color:"rgba(255,255,255,0.85)",
  whiteSpace:"nowrap" };

// ── Main admin dashboard ──────────────────────────────────────────────────────

export default function AdminApp() {
  const [session, setSession] = useState(undefined);
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [logging, setLogging] = useState(false);

  const [jobs, setJobs]   = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState([]);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  // Redirect non-admins silently
  useEffect(() => {
    if (session === undefined) return;
    if (session && session.user.email !== ADMIN_EMAIL) {
      window.location.replace("/");
    }
  }, [session]);

  const isAdmin = session && session.user.email === ADMIN_EMAIL;

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [jobsRes, usersRes] = await Promise.all([
        supabase.from("jobs").select("id, user_id, created_at, updated_at, customer, vehicle, config_name").order("created_at", { ascending: false }),
        supabase.rpc("admin_get_users"),
      ]);

      const allJobs = jobsRes.data || [];
      setJobs(allJobs);

      // Build chart: jobs per day last 30 days
      const days = last30Days();
      const countsByDay = {};
      for (const d of days) countsByDay[d] = 0;
      for (const j of allJobs) {
        const day = (j.created_at || "").slice(0, 10);
        if (countsByDay[day] !== undefined) countsByDay[day]++;
      }
      setChartData(days.map(d => ({ date: d, count: countsByDay[d] })));

      if (usersRes.data) setUsers(usersRes.data);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Login handler
  async function handleLogin(e) {
    e.preventDefault();
    setLogging(true);
    setAuthErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthErr(error.message);
    setLogging(false);
  }

  // Loading splash
  if (session === undefined) {
    return <div style={{ minHeight:"100dvh", background:"#050505" }}/>;
  }

  // Login screen (not signed in)
  if (!session) {
    return (
      <>
        <link rel="stylesheet" href={FONT_URL}/>
        <div style={{ minHeight:"100dvh", background:"#050505", display:"flex",
          alignItems:"center", justifyContent:"center", padding:24 }}>
          <div style={{ width:"100%", maxWidth:360 }}>
            <div style={{ fontFamily:FM, fontSize:22, color:"#eb0000", letterSpacing:"0.08em",
              marginBottom:32, textAlign:"center" }}>TRACKALIGN ADMIN</div>
            <form onSubmit={handleLogin} style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}
                style={inputStyle} autoComplete="email"/>
              <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}
                style={inputStyle} autoComplete="current-password"/>
              {authErr && <div style={{ color:"#eb0000", fontFamily:FB, fontSize:12 }}>{authErr}</div>}
              <button type="submit" disabled={logging}
                style={{ background:"#eb0000", border:"none", borderRadius:"0.3rem",
                  padding:"12px", color:"#fff", fontFamily:FB, fontWeight:"700",
                  fontSize:14, cursor:"pointer", marginTop:4 }}>
                {logging ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  // Non-admin (will redirect via useEffect but show blank meanwhile)
  if (!isAdmin) return <div style={{ minHeight:"100dvh", background:"#050505" }}/>;

  // Stats
  const now = new Date();
  const todayStart = startOf("day");
  const weekStart  = startOf("week");
  const monthStart = startOf("month");
  const jobsToday  = jobs.filter(j => j.created_at >= todayStart).length;
  const jobsWeek   = jobs.filter(j => j.created_at >= weekStart).length;
  const jobsMonth  = jobs.filter(j => j.created_at >= monthStart).length;

  return (
    <>
      <link rel="stylesheet" href={FONT_URL}/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0} body{background:#050505;color:#fff;font-family:${FB}} ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px}`}</style>
      <div style={{ minHeight:"100dvh", background:"#050505", padding:"0 0 60px" }}>

        {/* Header */}
        <div style={{ background:"#0a0a0a", borderBottom:"1px solid rgba(255,255,255,0.08)",
          padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontFamily:FM, fontSize:16, color:"#eb0000", letterSpacing:"0.08em" }}>
              TRACKALIGN ADMIN
            </div>
            <div style={{ fontFamily:FB, fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:2 }}>
              {session.user.email}
            </div>
          </div>
          <div style={{ display:"flex", gap:12, alignItems:"center" }}>
            <button onClick={fetchData} disabled={loading}
              style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:"0.3rem", padding:"6px 14px", color:"rgba(255,255,255,0.7)",
                fontFamily:FB, fontSize:12, cursor:"pointer" }}>
              {loading ? "Loading…" : "↺ Refresh"}
            </button>
            <button onClick={() => supabase.auth.signOut().then(() => window.location.replace("/"))}
              style={{ background:"none", border:"none", color:"rgba(255,255,255,0.4)",
                fontFamily:FB, fontSize:12, cursor:"pointer" }}>
              Sign Out
            </button>
          </div>
        </div>

        <div style={{ padding:"28px 24px", display:"flex", flexDirection:"column", gap:32 }}>

          {/* Summary cards */}
          <div>
            <SectionLabel>Overview</SectionLabel>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))", gap:12 }}>
              <StatCard label="Jobs Today"     value={jobsToday}     loading={loading}/>
              <StatCard label="Jobs This Week" value={jobsWeek}      loading={loading}/>
              <StatCard label="Jobs This Month" value={jobsMonth}    loading={loading}/>
              <StatCard label="Jobs All Time"  value={jobs.length}   loading={loading}/>
              <StatCard label="Total Users"    value={users.length}  loading={loading}/>
            </div>
          </div>

          {/* Bar chart */}
          <div>
            <SectionLabel>Jobs per Day — Last 30 Days</SectionLabel>
            <div style={{ background:"#111", border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:"0.5rem", padding:"20px 16px" }}>
              {loading
                ? <div style={{ height:184, display:"flex", alignItems:"center", justifyContent:"center",
                    color:"rgba(255,255,255,0.3)", fontFamily:FB, fontSize:13 }}>Loading…</div>
                : <BarChart data={chartData}/>
              }
            </div>
          </div>

          {/* Users table */}
          <div>
            <SectionLabel>Users ({users.length})</SectionLabel>
            <div style={{ background:"#111", border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:"0.5rem", overflowX:"auto" }}>
              {loading ? (
                <div style={{ padding:32, textAlign:"center", color:"rgba(255,255,255,0.3)",
                  fontFamily:FB, fontSize:13 }}>Loading…</div>
              ) : users.length === 0 ? (
                <div style={{ padding:32, textAlign:"center", color:"rgba(255,255,255,0.3)",
                  fontFamily:FB, fontSize:13 }}>No users found — ensure admin_get_users RPC exists</div>
              ) : (
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Email</th>
                      <th style={{...th, textAlign:"center"}}>Jobs</th>
                      <th style={th}>Last Active</th>
                      <th style={th}>Registered</th>
                      <th style={{...th, width:40}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <UserRow key={u.id} user={u} jobs={jobs}/>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontFamily:FB, fontSize:11, fontWeight:"700", letterSpacing:"0.1em",
      textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:12 }}>
      {children}
    </div>
  );
}

const inputStyle = {
  background:"#111", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"0.3rem",
  padding:"11px 14px", color:"#fff", fontFamily:FB, fontSize:14, outline:"none", width:"100%",
};
