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
// loads a lookup list once; returns [] until ready
function useList(path){
  const [d,setD]=useState([]);
  useEffect(()=>{ let on=true; api(path).then(r=>on&&setD(r||[])).catch(()=>{}); return ()=>{on=false}; },[path]);
  return d;
}
function Opts({items, value, onChange, labelKey="label", valueKey="id", placeholder="Select…"}){
  return (<select value={value} onChange={onChange}>
    <option value="">{placeholder}</option>
    {items.map(o=><option key={o[valueKey]} value={o[valueKey]}>{o[labelKey]||o.name||o.code}</option>)}
  </select>);
}
function Result({r}){ return r ? <div className="panel" style={{borderColor:"#bbf7d0",background:"#f0fdf4"}}>
  <b>Posted.</b> {Object.entries(r).map(([k,v])=><span key={k} style={{marginRight:16}}>
    <span className="muted">{k}:</span> {String(v)}</span>)}</div> : null; }
const genNo = pfx => pfx+"-"+Date.now().toString().slice(-8);

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

// ---- quality --------------------------------------------------------------
const RESULT_CLS={ACCEPT:"ok",REWORK:"warn",REJECT:"bad"};
function Quality(){
  const [sum,setSum]=useState(null); const [insp,setInsp]=useState([]); const [comp,setComp]=useState([]);
  const [err,setErr]=useState("");
  const [f,setF]=useState({delta_e:"",shade_match:true,inspected_qty:"",rejection_qty:"",colour_fastness:""});
  const load=useCallback(()=>{
    api("/api/quality/summary").then(setSum).catch(e=>setErr(e.message));
    api("/api/quality/inspections").then(setInsp).catch(()=>{});
    api("/api/quality/complaints").then(setComp).catch(()=>{});
  },[]);
  useEffect(()=>{load()},[load]);
  const add=async e=>{ e.preventDefault(); setErr("");
    const body={inspection_date:new Date().toISOString().slice(0,10),
      delta_e:f.delta_e||null, shade_match:f.shade_match,
      inspected_qty:f.inspected_qty||null, rejection_qty:f.rejection_qty||null,
      colour_fastness:f.colour_fastness||null};
    try{ await api("/api/quality/inspections",{method:"POST",body});
      setF({delta_e:"",shade_match:true,inspected_qty:"",rejection_qty:"",colour_fastness:""}); load(); }
    catch(ex){ setErr(ex.message); } };
  return (<div>
    <div className="cards">
      <Kpi label="Inspections" value={sum?sum.inspections:"…"} />
      <Kpi label="Accepted" value={sum?sum.accepted:"…"} cls="pos" />
      <Kpi label="Rework" value={sum?sum.rework:"…"} />
      <Kpi label="Rejected" value={sum?sum.rejected:"…"} cls={sum&&sum.rejected?"neg":""} />
      <Kpi label="Rejection rate" value={sum?Number(sum.rejection_rate_pct).toFixed(1)+"%":"…"} />
      <Kpi label="Open complaints" value={sum?sum.open_complaints:"…"} cls={sum&&sum.open_complaints?"neg":""} />
    </div>
    <Panel title="Record inspection">
      <form className="row" onSubmit={add}>
        <div className="field"><label>Delta E</label>
          <input value={f.delta_e} onChange={e=>setF({...f,delta_e:e.target.value})} placeholder="0.8"/></div>
        <div className="field"><label>Inspected qty</label>
          <input value={f.inspected_qty} onChange={e=>setF({...f,inspected_qty:e.target.value})} placeholder="100"/></div>
        <div className="field"><label>Rejection qty</label>
          <input value={f.rejection_qty} onChange={e=>setF({...f,rejection_qty:e.target.value})} placeholder="0"/></div>
        <div className="field"><label>Fastness</label>
          <input value={f.colour_fastness} onChange={e=>setF({...f,colour_fastness:e.target.value})} placeholder="4-5"/></div>
        <div className="field"><label>Shade match</label>
          <select value={f.shade_match?"yes":"no"} onChange={e=>setF({...f,shade_match:e.target.value==="yes"})}>
            <option value="yes">Yes</option><option value="no">No</option></select></div>
        <button className="btn">Record (auto-grades result)</button>
      </form>
      {err && <div className="err">{err}</div>}
    </Panel>
    <Panel title="Recent inspections">
      {insp.length===0 ? <div className="muted">No inspections yet.</div> :
      <table><thead><tr><th>No.</th><th>Date</th><th>Delta E</th><th>Fastness</th><th>Result</th></tr></thead>
      <tbody>{insp.slice(0,15).map(r=><tr key={r.id}><td>{r.number}</td><td>{r.inspection_date}</td>
        <td>{r.delta_e||"-"}</td><td>{r.colour_fastness||"-"}</td>
        <td><span className={"badge "+(RESULT_CLS[r.result]||"")}>{r.result}</span></td></tr>)}</tbody></table>}
    </Panel>
    <Panel title="Customer complaints">
      {comp.length===0 ? <div className="muted">No complaints.</div> :
      <table><thead><tr><th>No.</th><th>Date</th><th>Severity</th><th>Status</th><th>Description</th></tr></thead>
      <tbody>{comp.slice(0,15).map(r=><tr key={r.id}><td>{r.number}</td><td>{r.complaint_date}</td>
        <td>{r.severity}</td><td><span className={"badge "+(r.status==="OPEN"?"warn":"ok")}>{r.status}</span></td>
        <td>{r.description}</td></tr>)}</tbody></table>}
    </Panel>
  </div>);
}

// ---- masters: parties -----------------------------------------------------
function PartyPage({kind}){  // kind: "customers" | "suppliers"
  const [rows,setRows]=useState(null); const [err,setErr]=useState("");
  const [f,setF]=useState({code:"",name:"",gstin:"",state_code:""});
  const load=useCallback(()=>api(`/api/masters/${kind}`).then(setRows).catch(e=>setErr(e.message)),[kind]);
  useEffect(()=>{load()},[load]);
  const add=async e=>{ e.preventDefault(); setErr("");
    try{ await api(`/api/masters/${kind}`,{method:"POST",body:f});
      setF({code:"",name:"",gstin:"",state_code:""}); load(); }
    catch(ex){ setErr(ex.message); } };
  const title = kind==="customers"?"customer":"supplier";
  return (<div>
    <Panel title={"Add "+title}>
      <form className="row" onSubmit={add}>
        <div className="field"><label>Code</label><input required value={f.code}
          onChange={e=>setF({...f,code:e.target.value})} placeholder={kind==="customers"?"CUST-01":"SUP-01"}/></div>
        <div className="field"><label>Name</label><input required value={f.name}
          onChange={e=>setF({...f,name:e.target.value})} placeholder="Legal name"/></div>
        <div className="field"><label>GSTIN</label><input value={f.gstin}
          onChange={e=>setF({...f,gstin:e.target.value})} placeholder="03ABCDE1234F1Z5"/></div>
        <div className="field"><label>State code</label><input value={f.state_code}
          onChange={e=>setF({...f,state_code:e.target.value})} placeholder="03" style={{width:70}}/></div>
        <button className="btn">Add</button>
      </form>{err && <div className="err">{err}</div>}
    </Panel>
    <Panel title={title.charAt(0).toUpperCase()+title.slice(1)+"s"}>
      {!rows?"Loading…":<table><thead><tr><th>Code</th><th>Name</th><th>GSTIN</th><th>State</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td>{r.code}</td><td>{r.name}</td><td>{r.gstin||"-"}</td>
        <td>{r.state_code||"-"}</td></tr>)}</tbody></table>}
    </Panel>
  </div>);
}

// ---- transactions: purchase (GRN) -----------------------------------------
function Purchase(){
  const suppliers=useList("/api/masters/suppliers"); const chemicals=useList("/api/masters/chemicals");
  const warehouses=useList("/api/masters/warehouses"); const taxes=useList("/api/masters/tax-codes");
  const [hdr,setHdr]=useState({supplier_id:"",number:genNo("GRN"),grn_date:new Date().toISOString().slice(0,10)});
  const [lines,setLines]=useState([{chemical_id:"",warehouse_id:"",qty:"",unit_cost:"",tax_code_id:""}]);
  const [res,setRes]=useState(null); const [err,setErr]=useState("");
  const setLine=(i,k,v)=>setLines(ls=>ls.map((l,j)=>j===i?{...l,[k]:v}:l));
  const submit=async e=>{ e.preventDefault(); setErr(""); setRes(null);
    try{ const body={...hdr, lines:lines.map(l=>({chemical_id:l.chemical_id, warehouse_id:l.warehouse_id||null,
        qty:l.qty, unit_cost:l.unit_cost, tax_code_id:l.tax_code_id||null}))};
      const r=await api("/api/procurement/grn",{method:"POST",body}); setRes(r);
      setHdr({...hdr,number:genNo("GRN")});
      setLines([{chemical_id:"",warehouse_id:"",qty:"",unit_cost:"",tax_code_id:""}]); }
    catch(ex){ setErr(ex.message); } };
  return (<Panel title="Goods Receipt Note (chemical / dye purchase)">
    <form onSubmit={submit}>
      <div className="row mb">
        <div className="field"><label>Supplier</label>
          <Opts items={suppliers} value={hdr.supplier_id} onChange={e=>setHdr({...hdr,supplier_id:e.target.value})}/></div>
        <div className="field"><label>GRN number</label>
          <input value={hdr.number} onChange={e=>setHdr({...hdr,number:e.target.value})}/></div>
        <div className="field"><label>Date</label>
          <input type="date" value={hdr.grn_date} onChange={e=>setHdr({...hdr,grn_date:e.target.value})}/></div>
      </div>
      <table><thead><tr><th>Chemical</th><th>Warehouse</th><th className="num">Qty</th>
        <th className="num">Unit cost</th><th>Tax</th><th></th></tr></thead>
      <tbody>{lines.map((l,i)=><tr key={i}>
        <td><Opts items={chemicals} value={l.chemical_id} onChange={e=>setLine(i,"chemical_id",e.target.value)}/></td>
        <td><Opts items={warehouses} value={l.warehouse_id} onChange={e=>setLine(i,"warehouse_id",e.target.value)} placeholder="—"/></td>
        <td className="num"><input style={{width:90}} value={l.qty} onChange={e=>setLine(i,"qty",e.target.value)}/></td>
        <td className="num"><input style={{width:100}} value={l.unit_cost} onChange={e=>setLine(i,"unit_cost",e.target.value)}/></td>
        <td><Opts items={taxes} value={l.tax_code_id} onChange={e=>setLine(i,"tax_code_id",e.target.value)} placeholder="—"/></td>
        <td>{lines.length>1 && <button type="button" className="btn sec" onClick={()=>setLines(ls=>ls.filter((_,j)=>j!==i))}>✕</button>}</td>
      </tr>)}</tbody></table>
      <div className="row" style={{marginTop:12}}>
        <button type="button" className="btn sec" onClick={()=>setLines(ls=>[...ls,{chemical_id:"",warehouse_id:"",qty:"",unit_cost:"",tax_code_id:""}])}>+ Add line</button>
        <button className="btn">Post GRN</button>
      </div>
      {err && <div className="err">{err}</div>}
    </form>
    <Result r={res}/>
  </Panel>);
}

// ---- transactions: sales invoice ------------------------------------------
function Sales(){
  const customers=useList("/api/masters/customers"); const taxes=useList("/api/masters/tax-codes");
  const [hdr,setHdr]=useState({customer_id:"",number:genNo("INV"),invoice_date:new Date().toISOString().slice(0,10)});
  const [lines,setLines]=useState([{description:"",qty:"",rate:"",tax_code_id:""}]);
  const [res,setRes]=useState(null); const [err,setErr]=useState("");
  const setLine=(i,k,v)=>setLines(ls=>ls.map((l,j)=>j===i?{...l,[k]:v}:l));
  const submit=async e=>{ e.preventDefault(); setErr(""); setRes(null);
    try{ const body={...hdr, lines:lines.map(l=>({description:l.description, qty:l.qty, rate:l.rate,
        tax_code_id:l.tax_code_id||null}))};
      const r=await api("/api/sales/invoices",{method:"POST",body}); setRes(r);
      setHdr({...hdr,number:genNo("INV")}); setLines([{description:"",qty:"",rate:"",tax_code_id:""}]); }
    catch(ex){ setErr(ex.message); } };
  return (<Panel title="Sales invoice (with GST)">
    <form onSubmit={submit}>
      <div className="row mb">
        <div className="field"><label>Customer</label>
          <Opts items={customers} value={hdr.customer_id} onChange={e=>setHdr({...hdr,customer_id:e.target.value})}/></div>
        <div className="field"><label>Invoice number</label>
          <input value={hdr.number} onChange={e=>setHdr({...hdr,number:e.target.value})}/></div>
        <div className="field"><label>Date</label>
          <input type="date" value={hdr.invoice_date} onChange={e=>setHdr({...hdr,invoice_date:e.target.value})}/></div>
      </div>
      <table><thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th>Tax</th><th></th></tr></thead>
      <tbody>{lines.map((l,i)=><tr key={i}>
        <td><input style={{width:260}} value={l.description} onChange={e=>setLine(i,"description",e.target.value)} placeholder="Dyed fabric"/></td>
        <td className="num"><input style={{width:90}} value={l.qty} onChange={e=>setLine(i,"qty",e.target.value)}/></td>
        <td className="num"><input style={{width:90}} value={l.rate} onChange={e=>setLine(i,"rate",e.target.value)}/></td>
        <td><Opts items={taxes} value={l.tax_code_id} onChange={e=>setLine(i,"tax_code_id",e.target.value)} placeholder="—"/></td>
        <td>{lines.length>1 && <button type="button" className="btn sec" onClick={()=>setLines(ls=>ls.filter((_,j)=>j!==i))}>✕</button>}</td>
      </tr>)}</tbody></table>
      <div className="row" style={{marginTop:12}}>
        <button type="button" className="btn sec" onClick={()=>setLines(ls=>[...ls,{description:"",qty:"",rate:"",tax_code_id:""}])}>+ Add line</button>
        <button className="btn">Post invoice</button>
      </div>
      {err && <div className="err">{err}</div>}
    </form>
    <Result r={res}/>
  </Panel>);
}

// ---- transactions: dyeing (batch -> bath -> dispense -> register) ----------
function Dyeing(){
  const shades=useList("/api/masters/shades"); const machines=useList("/api/masters/machines?machine_type=DYEING");
  const versions=useList("/api/masters/recipe-versions");
  const [batch,setBatch]=useState(null); const [bath,setBath]=useState(null);
  const [order,setOrder]=useState(null); const [disp,setDisp]=useState(null); const [reg,setReg]=useState(null);
  const [err,setErr]=useState("");
  const [bf,setBf]=useState({batch_code:genNo("DY"),fabric_kg:"250",shade_id:""});
  const [hf,setHf]=useState({bath_code:"",machine_id:"",recipe_version_id:"",fabric_kg:"250"});
  const go=async(fn)=>{ setErr(""); try{ await fn(); }catch(ex){ setErr(ex.message); } };
  const createBatch=()=>go(async()=>{ const r=await api("/api/dyeing/batches",{method:"POST",body:bf});
    setBatch(r); setHf({...hf,bath_code:r.batch_code+"-B01",fabric_kg:bf.fabric_kg}); });
  const createBath=()=>go(async()=>{ const r=await api("/api/dyeing/baths",{method:"POST",
    body:{...hf,batch_id:batch.batch_id}}); setBath(r); setOrder(null); setDisp(null); setReg(null); });
  const preview=()=>go(async()=>setOrder(await api(`/api/dyeing/baths/${bath.bath_id}/dose-order`)));
  const dispense=()=>go(async()=>{ setDisp(await api(`/api/dyeing/baths/${bath.bath_id}/simulate-dispense`,{method:"POST"}));
    setReg(await api(`/api/dyeing/baths/${bath.bath_id}/consumption-register`)); });
  return (<div>
    <Panel title="1 · Create dye batch">
      <div className="row">
        <div className="field"><label>Batch code</label><input value={bf.batch_code}
          onChange={e=>setBf({...bf,batch_code:e.target.value})}/></div>
        <div className="field"><label>Fabric (kg)</label><input value={bf.fabric_kg}
          onChange={e=>setBf({...bf,fabric_kg:e.target.value})}/></div>
        <div className="field"><label>Shade</label>
          <Opts items={shades} value={bf.shade_id} onChange={e=>setBf({...bf,shade_id:e.target.value})}/></div>
        <button className="btn" onClick={createBatch}>Create batch</button>
      </div>
      {batch && <div className="muted" style={{marginTop:10}}>Batch {batch.batch_code} created ✓</div>}
    </Panel>
    {batch && <Panel title="2 · Add bath (approved recipe)">
      <div className="row">
        <div className="field"><label>Bath code</label><input value={hf.bath_code}
          onChange={e=>setHf({...hf,bath_code:e.target.value})}/></div>
        <div className="field"><label>Machine</label>
          <Opts items={machines} value={hf.machine_id} onChange={e=>setHf({...hf,machine_id:e.target.value})}/></div>
        <div className="field"><label>Recipe version</label>
          <Opts items={versions} value={hf.recipe_version_id} onChange={e=>setHf({...hf,recipe_version_id:e.target.value})}/></div>
        <div className="field"><label>Fabric (kg)</label><input value={hf.fabric_kg}
          onChange={e=>setHf({...hf,fabric_kg:e.target.value})}/></div>
        <button className="btn" onClick={createBath}>Create bath</button>
      </div>
      {bath && <div className="row" style={{marginTop:12}}>
        <span className="muted" style={{alignSelf:"center"}}>Bath {bath.bath_code} ✓</span>
        <button className="btn sec" onClick={preview}>Preview dose order</button>
        <button className="btn" onClick={dispense}>Simulate dispensing</button></div>}
    </Panel>}
    {order && <Panel title="Scaled dose order (ERP → Color Service)">
      <table><thead><tr><th>Seq</th><th>Material</th><th className="num">Target (kg)</th><th>Dye?</th></tr></thead>
      <tbody>{order.materials.map((m,i)=><tr key={i}><td>{m.sequence}</td><td>{m.material_code}</td>
        <td className="num">{m.target_qty}</td><td>{m.is_dye?"Dye":"Aux"}</td></tr>)}</tbody></table>
    </Panel>}
    {disp && <div className="cards">
      <Kpi label="Dispensed lines" value={disp.processed} />
      <Kpi label="Skipped (replay)" value={disp.skipped} />
      <Kpi label="Consumption cost" value={inr(disp.total_cost)} />
    </div>}
    {reg && <Panel title="Bath consumption register (recipe vs actual)">
      <table><thead><tr><th>Material</th><th className="num">Recipe</th><th className="num">Actual</th>
        <th className="num">Variance</th><th className="num">Cost</th></tr></thead>
      <tbody>{reg.rows.map((r,i)=><tr key={i}><td>{r.material_code}</td><td className="num">{r.recipe_target_kg}</td>
        <td className="num">{r.actual_kg}</td><td className="num">{r.variance_kg}</td>
        <td className="num">{inr2(r.cost)}</td></tr>)}</tbody>
      <tfoot><tr><th>Total</th><th></th><th className="num">{reg.total_actual_kg}</th><th></th>
        <th className="num">{inr2(reg.total_cost)}</th></tr></tfoot></table>
    </Panel>}
    {err && <Panel><div className="err">{err}</div></Panel>}
  </div>);
}

// ---- costing --------------------------------------------------------------
function Costing(){
  const [cpk,errc]=useData("/api/costing/cost-per-kg");
  const custs=useList("/api/costing/customers"); const orders=useList("/api/costing/orders");
  const machines=useList("/api/costing/machines");
  const pct = v => (Number(v||0)).toFixed(1)+"%";
  return (<div>
    <div className="cards">
      <Kpi label="Knitted cost / kg" value={cpk?inr(cpk.knitted_cost_per_kg):"…"} />
      <Kpi label="Dyeing cost / kg" value={cpk?inr(cpk.dyeing_cost_per_kg):"…"} />
      <Kpi label="Knitted output (kg)" value={cpk?inr2(cpk.knitted_kg):"…"} />
      <Kpi label="Dyed output (kg)" value={cpk?inr2(cpk.dyed_kg):"…"} />
    </div>
    <Panel title="Customer profitability">
      {custs.length===0 ? <div className="muted">No billed customers yet.</div> :
      <table><thead><tr><th>Customer</th><th className="num">Revenue</th><th className="num">Cost</th>
        <th className="num">Gross profit</th><th className="num">Margin</th></tr></thead>
      <tbody>{custs.map((c,i)=><tr key={i}><td>{c.customer}</td><td className="num">{inr2(c.revenue)}</td>
        <td className="num">{inr2(c.cost)}</td>
        <td className="num" style={{color:Number(c.gross_profit)>=0?"#16a34a":"#dc2626"}}>{inr2(c.gross_profit)}</td>
        <td className="num">{pct(c.margin_pct)}</td></tr>)}</tbody></table>}
    </Panel>
    <Panel title="Order profitability">
      {orders.filter(o=>Number(o.revenue)||Number(o.total_cost)).length===0 ?
        <div className="muted">No orders with activity yet.</div> :
      <table><thead><tr><th>Order</th><th className="num">Revenue</th><th className="num">Yarn</th>
        <th className="num">Dyeing</th><th className="num">Total cost</th><th className="num">Gross profit</th>
        <th className="num">Margin</th></tr></thead>
      <tbody>{orders.filter(o=>Number(o.revenue)||Number(o.total_cost)).map((o,i)=><tr key={i}>
        <td>{o.order_number}</td><td className="num">{inr2(o.revenue)}</td><td className="num">{inr2(o.yarn_cost)}</td>
        <td className="num">{inr2(o.dyeing_cost)}</td><td className="num">{inr2(o.total_cost)}</td>
        <td className="num" style={{color:Number(o.gross_profit)>=0?"#16a34a":"#dc2626"}}>{inr2(o.gross_profit)}</td>
        <td className="num">{pct(o.margin_pct)}</td></tr>)}</tbody></table>}
    </Panel>
    <Panel title="Machine-wise cost">
      {machines.length===0 ? <div className="muted">No machine cost yet.</div> :
      <table><thead><tr><th>Machine</th><th>Type</th><th className="num">Cost</th></tr></thead>
      <tbody>{machines.map((m,i)=><tr key={i}><td>{m.machine}</td><td>{m.machine_type}</td>
        <td className="num">{inr2(m.cost)}</td></tr>)}</tbody></table>}
    </Panel>
  </div>);
}

// ---- shell ----------------------------------------------------------------
const PAGES={
  owner:{t:"Owner Dashboard",c:OwnerDash}, factory:{t:"Factory Dashboard",c:FactoryDash},
  accounts:{t:"Accounts Dashboard",c:AccountsDash}, chemical:{t:"Chemical Dashboard",c:ChemicalDash},
  purchase:{t:"Purchase (GRN)",c:Purchase}, sales:{t:"Sales Invoice",c:Sales},
  dyeing:{t:"Dyeing & Dispensing",c:Dyeing},
  customers:{t:"Customers",c:()=> <PartyPage kind="customers"/>},
  suppliers:{t:"Suppliers",c:()=> <PartyPage kind="suppliers"/>},
  warehouses:{t:"Warehouses",c:Warehouses}, quality:{t:"Quality & Finishing",c:Quality},
  costing:{t:"Costing & Profitability",c:Costing}, reports:{t:"Reports",c:Reports},
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
        <div className="group">Transactions</div>
        {navBtn("purchase","Purchase (GRN)")}{navBtn("sales","Sales Invoice")}
        {navBtn("dyeing","Dyeing & Dispensing")}
        <div className="group">Masters</div>
        {navBtn("customers","Customers")}{navBtn("suppliers","Suppliers")}{navBtn("warehouses","Warehouses")}
        <div className="group">Quality</div>{navBtn("quality","Quality")}
        <div className="group">Costing</div>{navBtn("costing","Costing")}
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
