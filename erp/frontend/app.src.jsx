// Source JSX for the ERP SPA. Precompiled to app.js (see build-ui.sh).
const {useState, useEffect, useCallback} = React;
const R = window.Recharts || null;

// ---- api helper ----------------------------------------------------------
const TOKEN_KEY = "erp_token";
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY) }catch(e){ return null } }
function setToken(t){ try{ t?localStorage.setItem(TOKEN_KEY,t):localStorage.removeItem(TOKEN_KEY) }catch(e){} }

async function api(path, {method, body, form, blob}={}){
  if(!method) method = (form || body!==undefined) ? "POST" : "GET";
  const headers={}; const tok=getToken(); if(tok) headers["Authorization"]="Bearer "+tok;
  let payload;
  if(form){ payload=new URLSearchParams(form); headers["Content-Type"]="application/x-www-form-urlencoded"; }
  else if(body!==undefined){ payload=JSON.stringify(body); headers["Content-Type"]="application/json"; }
  const res=await fetch(path,{method,headers,body:payload});
  if(res.status===401){ setToken(null); location.reload(); throw new Error("Unauthorized"); }
  if(blob){ if(!res.ok) throw new Error("Download failed"); return await res.blob(); }
  const ct=res.headers.get("content-type")||"";
  const data= ct.includes("json") ? await res.json() : await res.text();
  if(!res.ok) throw new Error((data && data.detail) || ("Error "+res.status));
  return data;
}
const inr = n => Number(n||0).toLocaleString("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0});
const inr2 = n => Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

// ---- small components -----------------------------------------------------
function Kpi({label, value, cls}){ return (
  <div className="card"><div className="label">{label}</div>
    <div className={"value "+(cls||"")}>{value}</div></div> ); }

function Panel({title, children}){ return (
  <div className="panel">{title && <h3>{title}</h3>}{children}</div> ); }

// ---- login ----------------------------------------------------------------
function Login({onLogin}){
  const [u,setU]=useState("admin"); const [p,setP]=useState("admin123"); const [err,setErr]=useState("");
  const submit=async e=>{ e.preventDefault(); setErr("");
    try{ const r=await api("/api/auth/login",{form:{username:u,password:p}}); setToken(r.access_token); onLogin(); }
    catch(ex){ setErr("Invalid username or password"); } };
  return (<div className="login"><form className="box" onSubmit={submit}>
    <h2>Textile ERP</h2><p>Integrated Knitting &amp; Dyeing ERP</p>
    <div className="field"><label>Username</label><input value={u} onChange={e=>setU(e.target.value)} /></div>
    <div className="field"><label>Password</label><input type="password" value={p} onChange={e=>setP(e.target.value)} /></div>
    <button className="btn" style={{width:"100%"}}>Sign in</button>
    {err && <div className="err">{err}</div>}
    <p className="muted" style={{marginTop:16,fontSize:12}}>Demo: admin / admin123</p>
  </form></div>);
}

// ---- data hook ------------------------------------------------------------
function useData(path){
  const [d,setD]=useState(null); const [err,setErr]=useState("");
  useEffect(()=>{ let on=true; api(path).then(r=>on&&setD(r)).catch(e=>on&&setErr(e.message));
    return ()=>{on=false}; },[path]);
  return [d,err];
}

function OwnerDash(){
  const [d,err]=useData("/api/dashboard/owner");
  if(err) return <Panel>{err}</Panel>; if(!d) return <Panel>Loading…</Panel>;
  const np=Number(d.net_profit);
  return (<div>
    <div className="cards">
      <Kpi label="Revenue (YTD)" value={inr(d.revenue)} />
      <Kpi label="Gross Profit" value={inr(d.gross_profit)} />
      <Kpi label="Net Profit" value={inr(d.net_profit)} cls={np>=0?"pos":"neg"} />
      <Kpi label="Cash & Bank" value={inr(d.cash_and_bank)} />
      <Kpi label="Receivables" value={inr(d.receivables)} />
      <Kpi label="Payables" value={inr(d.payables)} />
      <Kpi label="Inventory Value" value={inr(d.inventory_value)} />
    </div>
    <Panel title="Sales trend (last 6 months)">
      {R ? <div className="chartbox"><R.ResponsiveContainer>
        <R.LineChart data={(d.sales_trend||[]).map(p=>({month:p.month, amount:Number(p.amount)}))}
          margin={{top:10,right:20,left:10,bottom:0}}>
          <R.CartesianGrid strokeDasharray="3 3" stroke="#eef2f7"/>
          <R.XAxis dataKey="month" fontSize={12}/><R.YAxis fontSize={12} tickFormatter={v=>v/1000+"k"}/>
          <R.Tooltip formatter={v=>inr(v)}/>
          <R.Line type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={2} dot={{r:3}}/>
        </R.LineChart></R.ResponsiveContainer></div>
        : <SalesTable rows={d.sales_trend}/>}
    </Panel>
  </div>);
}
function SalesTable({rows}){ return (<table><thead><tr><th>Month</th><th className="num">Sales</th></tr></thead>
  <tbody>{(rows||[]).map((r,i)=><tr key={i}><td>{r.month}</td><td className="num">{inr2(r.amount)}</td></tr>)}</tbody></table>); }

function FactoryDash(){
  const [d,err]=useData("/api/dashboard/factory");
  if(err) return <Panel>{err}</Panel>; if(!d) return <Panel>Loading…</Panel>;
  return (<div className="cards">
    <Kpi label="Knitting output (kg)" value={inr2(d.knitting_output_kg)} />
    <Kpi label="Dyeing output (kg)" value={inr2(d.dyeing_output_kg)} />
    <Kpi label="Active batches" value={d.active_batches} />
    <Kpi label="Chemical consumption" value={inr(d.chemical_consumption_cost)} />
  </div>);
}

function AccountsDash(){
  const [d,err]=useData("/api/dashboard/accounts");
  if(err) return <Panel>{err}</Panel>; if(!d) return <Panel>Loading…</Panel>;
  return (<div>
    <div className="cards">
      <Kpi label="Today's receipts" value={inr(d.today_receipts)} />
      <Kpi label="Today's payments" value={inr(d.today_payments)} />
      <Kpi label="Debtors outstanding" value={inr(d.debtors_total)} />
      <Kpi label="Creditors outstanding" value={inr(d.creditors_total)} />
      <Kpi label="GST net payable" value={inr(d.gst_net_payable)} />
      <div className="card"><div className="label">Trial balance</div>
        <div className="value"><span className={"badge "+(d.trial_balance_balanced?"ok":"bad")}>
          {d.trial_balance_balanced?"Balanced":"Out of balance"}</span></div></div>
    </div>
    <Panel title="Bank balances">
      <table><thead><tr><th>Account</th><th className="num">Balance</th></tr></thead>
      <tbody>{(d.bank_balances||[]).map((b,i)=><tr key={i}><td>{b.name}</td>
        <td className="num">{inr2(b.balance)}</td></tr>)}</tbody></table>
    </Panel>
  </div>);
}

function ChemicalDash(){
  const [d,err]=useData("/api/dashboard/chemical");
  if(err) return <Panel>{err}</Panel>; if(!d) return <Panel>Loading…</Panel>;
  const bars=(d.top_consumption||[]).map(r=>({material:r.material, cost:Number(r.cost)}));
  return (<div>
    <div className="cards">
      <Kpi label="Dye cost" value={inr(d.dye_cost)} />
      <Kpi label="Chemical cost" value={inr(d.chemical_cost)} />
      <Kpi label="Total consumption" value={inr(d.total_consumption_cost)} />
      <Kpi label="Dispensing errors" value={d.dispensing_errors} cls={d.dispensing_errors?"neg":""} />
    </div>
    <Panel title="Top consumption by material">
      {R ? <div className="chartbox"><R.ResponsiveContainer>
        <R.BarChart data={bars} margin={{top:10,right:20,left:10,bottom:0}}>
          <R.CartesianGrid strokeDasharray="3 3" stroke="#eef2f7"/>
          <R.XAxis dataKey="material" fontSize={12}/><R.YAxis fontSize={12}/>
          <R.Tooltip formatter={v=>inr(v)}/><R.Bar dataKey="cost" fill="#2563eb" radius={[4,4,0,0]}/>
        </R.BarChart></R.ResponsiveContainer></div>
        : <table><tbody>{bars.map((b,i)=><tr key={i}><td>{b.material}</td>
          <td className="num">{inr2(b.cost)}</td></tr>)}</tbody></table>}
    </Panel>
    <Panel title="Stock alerts">
      {(d.stock_alerts||[]).length===0 ? <div className="muted">No chemicals below reorder level.</div> :
      <table><thead><tr><th>Code</th><th>Name</th><th className="num">On hand</th><th className="num">Reorder</th></tr></thead>
      <tbody>{d.stock_alerts.map((a,i)=><tr key={i}><td>{a.code}</td><td>{a.name}</td>
        <td className="num">{inr2(a.on_hand)}</td><td className="num">{inr2(a.reorder_level)}</td></tr>)}</tbody></table>}
    </Panel>
  </div>);
}

// ---- masters: warehouses --------------------------------------------------
function Warehouses(){
  const [rows,setRows]=useState(null); const [err,setErr]=useState("");
  const [f,setF]=useState({code:"",name:"",kind:"STORE"});
  const load=useCallback(()=>api("/api/masters/warehouses").then(setRows).catch(e=>setErr(e.message)),[]);
  useEffect(()=>{load()},[load]);
  const add=async e=>{ e.preventDefault(); setErr("");
    try{ await api("/api/masters/warehouses",{method:"POST",body:f});
      setF({code:"",name:"",kind:"STORE"}); load(); }
    catch(ex){ setErr(ex.message); } };
  return (<div>
    <Panel title="Add warehouse">
      <form className="row" onSubmit={add}>
        <div className="field"><label>Code</label>
          <input required value={f.code} onChange={e=>setF({...f,code:e.target.value})} placeholder="WH-XYZ"/></div>
        <div className="field"><label>Name</label>
          <input required value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Store name"/></div>
        <div className="field"><label>Kind</label>
          <select value={f.kind} onChange={e=>setF({...f,kind:e.target.value})}>
            <option>STORE</option><option>GREIGE</option><option>FG</option><option>DISPENSING_TANK</option>
          </select></div>
        <button className="btn">Add warehouse</button>
      </form>
      {err && <div className="err">{err}</div>}
    </Panel>
    <Panel title="Warehouses">
      {!rows ? "Loading…" :
      <table><thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Status</th></tr></thead>
      <tbody>{rows.map(w=><tr key={w.id}><td>{w.code}</td><td>{w.name}</td><td>{w.kind}</td>
        <td><span className={"badge "+(w.is_active?"ok":"bad")}>{w.is_active?"Active":"Inactive"}</span></td></tr>)}
      </tbody></table>}
    </Panel>
  </div>);
}

// ---- reports (authenticated downloads) ------------------------------------
const REPORTS=[
  ["trial-balance","Trial Balance"],["profit-and-loss","Profit & Loss"],["balance-sheet","Balance Sheet"],
  ["cash-flow","Cash Flow"],["debtors-ageing","Debtors Ageing"],["creditors-ageing","Creditors Ageing"],
  ["gst-sales-register","GST Sales Register"],["gst-purchase-register","GST Purchase Register"],
  ["gstr3b","GSTR-3B"],["stock-reconciliation","Stock vs GL Reconciliation"],
];
function Reports(){
  const [fmt,setFmt]=useState("xlsx"); const [busy,setBusy]=useState("");
  const dl=async(rep)=>{ setBusy(rep);
    try{ const blob=await api(`/api/reports/export/${rep}?format=${fmt}`,{blob:true});
      const url=URL.createObjectURL(blob); const a=document.createElement("a");
      a.href=url; a.download=`${rep}.${fmt}`; a.click(); URL.revokeObjectURL(url); }
    catch(e){ alert(e.message); } finally{ setBusy(""); } };
  return (<Panel title="Download reports">
    <div className="row mb"><div className="field"><label>Format</label>
      <select value={fmt} onChange={e=>setFmt(e.target.value)}><option value="xlsx">Excel</option>
      <option value="pdf">PDF</option></select></div></div>
    <table><thead><tr><th>Report</th><th></th></tr></thead><tbody>
      {REPORTS.map(([id,label])=><tr key={id}><td>{label}</td>
        <td className="num"><button className="btn sec" disabled={busy===id}
          onClick={()=>dl(id)}>{busy===id?"…":"Download"}</button></td></tr>)}
    </tbody></table>
  </Panel>);
}

// ---- shell ----------------------------------------------------------------
const PAGES={
  owner:{t:"Owner Dashboard",c:OwnerDash}, factory:{t:"Factory Dashboard",c:FactoryDash},
  accounts:{t:"Accounts Dashboard",c:AccountsDash}, chemical:{t:"Chemical Dashboard",c:ChemicalDash},
  warehouses:{t:"Warehouses",c:Warehouses}, reports:{t:"Reports",c:Reports},
};
function App(){
  const [page,setPage]=useState("owner"); const [me,setMe]=useState(null);
  useEffect(()=>{ api("/api/auth/me").then(setMe).catch(()=>{}); },[]);
  const Cur=PAGES[page].c;
  const navBtn=(id,label)=> <button className={page===id?"active":""} onClick={()=>setPage(id)}>{label}</button>;
  return (<div className="app">
    <aside className="sidebar">
      <div className="brand">Textile ERP<small>Knitting &amp; Dyeing</small></div>
      <nav className="nav">
        <div className="group">Dashboards</div>
        {navBtn("owner","Owner")}{navBtn("factory","Factory")}
        {navBtn("accounts","Accounts")}{navBtn("chemical","Chemical")}
        <div className="group">Masters</div>{navBtn("warehouses","Warehouses")}
        <div className="group">Reports</div>{navBtn("reports","Reports")}
        <div className="group">Session</div>
        <button onClick={()=>{setToken(null); location.reload();}}>Log out</button>
      </nav>
    </aside>
    <div className="main">
      <div className="topbar"><h1>{PAGES[page].t}</h1>
        <div className="who">{me? (me.full_name||me.username) : ""} · {new Date().toLocaleDateString("en-IN")}</div></div>
      <div className="content"><Cur/></div>
    </div>
  </div>);
}

function Root(){
  const [authed,setAuthed]=useState(!!getToken());
  return authed ? <App/> : <Login onLogin={()=>setAuthed(true)} />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<Root/>);
