// AUTO-GENERATED from app.src.jsx by build-ui.sh — do not edit directly.
// Source JSX for the ERP SPA. Precompiled to app.js (see build-ui.sh).
const {
  useState,
  useEffect,
  useCallback
} = React;
const R = window.Recharts || null;

// ---- api helper ----------------------------------------------------------
const TOKEN_KEY = "erp_token";
function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}
function setToken(t) {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}
async function api(path, {
  method,
  body,
  form,
  blob
} = {}) {
  if (!method) method = form || body !== undefined ? "POST" : "GET";
  const headers = {};
  const tok = getToken();
  if (tok) headers["Authorization"] = "Bearer " + tok;
  let payload;
  if (form) {
    payload = new URLSearchParams(form);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, {
    method,
    headers,
    body: payload
  });
  if (res.status === 401) {
    setToken(null);
    location.reload();
    throw new Error("Unauthorized");
  }
  if (blob) {
    if (!res.ok) throw new Error("Download failed");
    return await res.blob();
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data && data.detail || "Error " + res.status);
  return data;
}
const inr = n => Number(n || 0).toLocaleString("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});
const inr2 = n => Number(n || 0).toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

// ---- small components -----------------------------------------------------
function Kpi({
  label,
  value,
  cls
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "label"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "value " + (cls || "")
  }, value));
}
function Panel({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, title && /*#__PURE__*/React.createElement("h3", null, title), children);
}

// ---- login ----------------------------------------------------------------
function Login({
  onLogin
}) {
  const [u, setU] = useState("admin");
  const [p, setP] = useState("admin123");
  const [err, setErr] = useState("");
  const submit = async e => {
    e.preventDefault();
    setErr("");
    try {
      const r = await api("/api/auth/login", {
        form: {
          username: u,
          password: p
        }
      });
      setToken(r.access_token);
      onLogin();
    } catch (ex) {
      setErr("Invalid username or password");
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "login"
  }, /*#__PURE__*/React.createElement("form", {
    className: "box",
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("h2", null, "Textile ERP"), /*#__PURE__*/React.createElement("p", null, "Integrated Knitting & Dyeing ERP"), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Username"), /*#__PURE__*/React.createElement("input", {
    value: u,
    onChange: e => setU(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Password"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: p,
    onChange: e => setP(e.target.value)
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    style: {
      width: "100%"
    }
  }, "Sign in"), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err), /*#__PURE__*/React.createElement("p", {
    className: "muted",
    style: {
      marginTop: 16,
      fontSize: 12
    }
  }, "Demo: admin / admin123")));
}

// ---- data hook ------------------------------------------------------------
function useData(path) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    api(path).then(r => on && setD(r)).catch(e => on && setErr(e.message));
    return () => {
      on = false;
    };
  }, [path]);
  return [d, err];
}
// loads a lookup list once; returns [] until ready
function useList(path) {
  const [d, setD] = useState([]);
  useEffect(() => {
    let on = true;
    api(path).then(r => on && setD(r || [])).catch(() => {});
    return () => {
      on = false;
    };
  }, [path]);
  return d;
}
function Opts({
  items,
  value,
  onChange,
  labelKey = "label",
  valueKey = "id",
  placeholder = "Select…"
}) {
  return /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: onChange
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, placeholder), items.map(o => /*#__PURE__*/React.createElement("option", {
    key: o[valueKey],
    value: o[valueKey]
  }, o[labelKey] || o.name || o.code)));
}
function Result({
  r
}) {
  return r ? /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      borderColor: "#bbf7d0",
      background: "#f0fdf4"
    }
  }, /*#__PURE__*/React.createElement("b", null, "Posted."), " ", Object.entries(r).map(([k, v]) => /*#__PURE__*/React.createElement("span", {
    key: k,
    style: {
      marginRight: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, k, ":"), " ", String(v)))) : null;
}
const genNo = pfx => pfx + "-" + Date.now().toString().slice(-8);
function OwnerDash() {
  const [d, err] = useData("/api/dashboard/owner");
  if (err) return /*#__PURE__*/React.createElement(Panel, null, err);
  if (!d) return /*#__PURE__*/React.createElement(Panel, null, "Loading\u2026");
  const np = Number(d.net_profit);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Revenue (YTD)",
    value: inr(d.revenue)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Gross Profit",
    value: inr(d.gross_profit)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Net Profit",
    value: inr(d.net_profit),
    cls: np >= 0 ? "pos" : "neg"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Cash & Bank",
    value: inr(d.cash_and_bank)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Receivables",
    value: inr(d.receivables)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Payables",
    value: inr(d.payables)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Inventory Value",
    value: inr(d.inventory_value)
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Sales trend (last 6 months)"
  }, R ? /*#__PURE__*/React.createElement("div", {
    className: "chartbox"
  }, /*#__PURE__*/React.createElement(R.ResponsiveContainer, null, /*#__PURE__*/React.createElement(R.LineChart, {
    data: (d.sales_trend || []).map(p => ({
      month: p.month,
      amount: Number(p.amount)
    })),
    margin: {
      top: 10,
      right: 20,
      left: 10,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(R.CartesianGrid, {
    strokeDasharray: "3 3",
    stroke: "#eef2f7"
  }), /*#__PURE__*/React.createElement(R.XAxis, {
    dataKey: "month",
    fontSize: 12
  }), /*#__PURE__*/React.createElement(R.YAxis, {
    fontSize: 12,
    tickFormatter: v => v / 1000 + "k"
  }), /*#__PURE__*/React.createElement(R.Tooltip, {
    formatter: v => inr(v)
  }), /*#__PURE__*/React.createElement(R.Line, {
    type: "monotone",
    dataKey: "amount",
    stroke: "#2563eb",
    strokeWidth: 2,
    dot: {
      r: 3
    }
  })))) : /*#__PURE__*/React.createElement(SalesTable, {
    rows: d.sales_trend
  })));
}
function SalesTable({
  rows
}) {
  return /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Month"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Sales"))), /*#__PURE__*/React.createElement("tbody", null, (rows || []).map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, r.month), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(r.amount))))));
}
function FactoryDash() {
  const [d, err] = useData("/api/dashboard/factory");
  if (err) return /*#__PURE__*/React.createElement(Panel, null, err);
  if (!d) return /*#__PURE__*/React.createElement(Panel, null, "Loading\u2026");
  return /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Knitting output (kg)",
    value: inr2(d.knitting_output_kg)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Dyeing output (kg)",
    value: inr2(d.dyeing_output_kg)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Active batches",
    value: d.active_batches
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Chemical consumption",
    value: inr(d.chemical_consumption_cost)
  }));
}
function AccountsDash() {
  const [d, err] = useData("/api/dashboard/accounts");
  if (err) return /*#__PURE__*/React.createElement(Panel, null, err);
  if (!d) return /*#__PURE__*/React.createElement(Panel, null, "Loading\u2026");
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Today's receipts",
    value: inr(d.today_receipts)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Today's payments",
    value: inr(d.today_payments)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Debtors outstanding",
    value: inr(d.debtors_total)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Creditors outstanding",
    value: inr(d.creditors_total)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "GST net payable",
    value: inr(d.gst_net_payable)
  }), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "label"
  }, "Trial balance"), /*#__PURE__*/React.createElement("div", {
    className: "value"
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge " + (d.trial_balance_balanced ? "ok" : "bad")
  }, d.trial_balance_balanced ? "Balanced" : "Out of balance")))), /*#__PURE__*/React.createElement(Panel, {
    title: "Bank balances"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Account"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Balance"))), /*#__PURE__*/React.createElement("tbody", null, (d.bank_balances || []).map((b, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, b.name), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(b.balance))))))));
}
function ChemicalDash() {
  const [d, err] = useData("/api/dashboard/chemical");
  if (err) return /*#__PURE__*/React.createElement(Panel, null, err);
  if (!d) return /*#__PURE__*/React.createElement(Panel, null, "Loading\u2026");
  const bars = (d.top_consumption || []).map(r => ({
    material: r.material,
    cost: Number(r.cost)
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Dye cost",
    value: inr(d.dye_cost)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Chemical cost",
    value: inr(d.chemical_cost)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Total consumption",
    value: inr(d.total_consumption_cost)
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Dispensing errors",
    value: d.dispensing_errors,
    cls: d.dispensing_errors ? "neg" : ""
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Top consumption by material"
  }, R ? /*#__PURE__*/React.createElement("div", {
    className: "chartbox"
  }, /*#__PURE__*/React.createElement(R.ResponsiveContainer, null, /*#__PURE__*/React.createElement(R.BarChart, {
    data: bars,
    margin: {
      top: 10,
      right: 20,
      left: 10,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(R.CartesianGrid, {
    strokeDasharray: "3 3",
    stroke: "#eef2f7"
  }), /*#__PURE__*/React.createElement(R.XAxis, {
    dataKey: "material",
    fontSize: 12
  }), /*#__PURE__*/React.createElement(R.YAxis, {
    fontSize: 12
  }), /*#__PURE__*/React.createElement(R.Tooltip, {
    formatter: v => inr(v)
  }), /*#__PURE__*/React.createElement(R.Bar, {
    dataKey: "cost",
    fill: "#2563eb",
    radius: [4, 4, 0, 0]
  })))) : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("tbody", null, bars.map((b, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, b.material), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(b.cost))))))), /*#__PURE__*/React.createElement(Panel, {
    title: "Stock alerts"
  }, (d.stock_alerts || []).length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No chemicals below reorder level.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Code"), /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "On hand"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Reorder"))), /*#__PURE__*/React.createElement("tbody", null, d.stock_alerts.map((a, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, a.code), /*#__PURE__*/React.createElement("td", null, a.name), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(a.on_hand)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(a.reorder_level))))))));
}

// ---- masters: warehouses --------------------------------------------------
function Warehouses() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    code: "",
    name: "",
    kind: "STORE"
  });
  const load = useCallback(() => api("/api/masters/warehouses").then(setRows).catch(e => setErr(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  const add = async e => {
    e.preventDefault();
    setErr("");
    try {
      await api("/api/masters/warehouses", {
        method: "POST",
        body: f
      });
      setF({
        code: "",
        name: "",
        kind: "STORE"
      });
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Panel, {
    title: "Add warehouse"
  }, /*#__PURE__*/React.createElement("form", {
    className: "row",
    onSubmit: add
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Code"), /*#__PURE__*/React.createElement("input", {
    required: true,
    value: f.code,
    onChange: e => setF({
      ...f,
      code: e.target.value
    }),
    placeholder: "WH-XYZ"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Name"), /*#__PURE__*/React.createElement("input", {
    required: true,
    value: f.name,
    onChange: e => setF({
      ...f,
      name: e.target.value
    }),
    placeholder: "Store name"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Kind"), /*#__PURE__*/React.createElement("select", {
    value: f.kind,
    onChange: e => setF({
      ...f,
      kind: e.target.value
    })
  }, /*#__PURE__*/React.createElement("option", null, "STORE"), /*#__PURE__*/React.createElement("option", null, "GREIGE"), /*#__PURE__*/React.createElement("option", null, "FG"), /*#__PURE__*/React.createElement("option", null, "DISPENSING_TANK"))), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Add warehouse")), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err)), /*#__PURE__*/React.createElement(Panel, {
    title: "Warehouses"
  }, !rows ? "Loading…" : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Code"), /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", null, "Kind"), /*#__PURE__*/React.createElement("th", null, "Status"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(w => /*#__PURE__*/React.createElement("tr", {
    key: w.id
  }, /*#__PURE__*/React.createElement("td", null, w.code), /*#__PURE__*/React.createElement("td", null, w.name), /*#__PURE__*/React.createElement("td", null, w.kind), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge " + (w.is_active ? "ok" : "bad")
  }, w.is_active ? "Active" : "Inactive"))))))));
}

// ---- reports (authenticated downloads) ------------------------------------
const REPORTS = [["trial-balance", "Trial Balance"], ["profit-and-loss", "Profit & Loss"], ["balance-sheet", "Balance Sheet"], ["cash-flow", "Cash Flow"], ["debtors-ageing", "Debtors Ageing"], ["creditors-ageing", "Creditors Ageing"], ["gst-sales-register", "GST Sales Register"], ["gst-purchase-register", "GST Purchase Register"], ["gstr3b", "GSTR-3B"], ["stock-reconciliation", "Stock vs GL Reconciliation"]];
function Reports() {
  const [fmt, setFmt] = useState("xlsx");
  const [busy, setBusy] = useState("");
  const dl = async rep => {
    setBusy(rep);
    try {
      const blob = await api(`/api/reports/export/${rep}?format=${fmt}`, {
        blob: true
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${rep}.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy("");
    }
  };
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Download reports"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row mb"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Format"), /*#__PURE__*/React.createElement("select", {
    value: fmt,
    onChange: e => setFmt(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "xlsx"
  }, "Excel"), /*#__PURE__*/React.createElement("option", {
    value: "pdf"
  }, "PDF")))), /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Report"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, REPORTS.map(([id, label]) => /*#__PURE__*/React.createElement("tr", {
    key: id
  }, /*#__PURE__*/React.createElement("td", null, label), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sec",
    disabled: busy === id,
    onClick: () => dl(id)
  }, busy === id ? "…" : "Download")))))));
}

// ---- quality --------------------------------------------------------------
const RESULT_CLS = {
  ACCEPT: "ok",
  REWORK: "warn",
  REJECT: "bad"
};
function Quality() {
  const [sum, setSum] = useState(null);
  const [insp, setInsp] = useState([]);
  const [comp, setComp] = useState([]);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    delta_e: "",
    shade_match: true,
    inspected_qty: "",
    rejection_qty: "",
    colour_fastness: ""
  });
  const load = useCallback(() => {
    api("/api/quality/summary").then(setSum).catch(e => setErr(e.message));
    api("/api/quality/inspections").then(setInsp).catch(() => {});
    api("/api/quality/complaints").then(setComp).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const add = async e => {
    e.preventDefault();
    setErr("");
    const body = {
      inspection_date: new Date().toISOString().slice(0, 10),
      delta_e: f.delta_e || null,
      shade_match: f.shade_match,
      inspected_qty: f.inspected_qty || null,
      rejection_qty: f.rejection_qty || null,
      colour_fastness: f.colour_fastness || null
    };
    try {
      await api("/api/quality/inspections", {
        method: "POST",
        body
      });
      setF({
        delta_e: "",
        shade_match: true,
        inspected_qty: "",
        rejection_qty: "",
        colour_fastness: ""
      });
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Inspections",
    value: sum ? sum.inspections : "…"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Accepted",
    value: sum ? sum.accepted : "…",
    cls: "pos"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Rework",
    value: sum ? sum.rework : "…"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Rejected",
    value: sum ? sum.rejected : "…",
    cls: sum && sum.rejected ? "neg" : ""
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Rejection rate",
    value: sum ? Number(sum.rejection_rate_pct).toFixed(1) + "%" : "…"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Open complaints",
    value: sum ? sum.open_complaints : "…",
    cls: sum && sum.open_complaints ? "neg" : ""
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Record inspection"
  }, /*#__PURE__*/React.createElement("form", {
    className: "row",
    onSubmit: add
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Delta E"), /*#__PURE__*/React.createElement("input", {
    value: f.delta_e,
    onChange: e => setF({
      ...f,
      delta_e: e.target.value
    }),
    placeholder: "0.8"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Inspected qty"), /*#__PURE__*/React.createElement("input", {
    value: f.inspected_qty,
    onChange: e => setF({
      ...f,
      inspected_qty: e.target.value
    }),
    placeholder: "100"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Rejection qty"), /*#__PURE__*/React.createElement("input", {
    value: f.rejection_qty,
    onChange: e => setF({
      ...f,
      rejection_qty: e.target.value
    }),
    placeholder: "0"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Fastness"), /*#__PURE__*/React.createElement("input", {
    value: f.colour_fastness,
    onChange: e => setF({
      ...f,
      colour_fastness: e.target.value
    }),
    placeholder: "4-5"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Shade match"), /*#__PURE__*/React.createElement("select", {
    value: f.shade_match ? "yes" : "no",
    onChange: e => setF({
      ...f,
      shade_match: e.target.value === "yes"
    })
  }, /*#__PURE__*/React.createElement("option", {
    value: "yes"
  }, "Yes"), /*#__PURE__*/React.createElement("option", {
    value: "no"
  }, "No"))), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Record (auto-grades result)")), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err)), /*#__PURE__*/React.createElement(Panel, {
    title: "Recent inspections"
  }, insp.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No inspections yet.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "No."), /*#__PURE__*/React.createElement("th", null, "Date"), /*#__PURE__*/React.createElement("th", null, "Delta E"), /*#__PURE__*/React.createElement("th", null, "Fastness"), /*#__PURE__*/React.createElement("th", null, "Result"))), /*#__PURE__*/React.createElement("tbody", null, insp.slice(0, 15).map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.id
  }, /*#__PURE__*/React.createElement("td", null, r.number), /*#__PURE__*/React.createElement("td", null, r.inspection_date), /*#__PURE__*/React.createElement("td", null, r.delta_e || "-"), /*#__PURE__*/React.createElement("td", null, r.colour_fastness || "-"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge " + (RESULT_CLS[r.result] || "")
  }, r.result))))))), /*#__PURE__*/React.createElement(Panel, {
    title: "Customer complaints"
  }, comp.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No complaints.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "No."), /*#__PURE__*/React.createElement("th", null, "Date"), /*#__PURE__*/React.createElement("th", null, "Severity"), /*#__PURE__*/React.createElement("th", null, "Status"), /*#__PURE__*/React.createElement("th", null, "Description"))), /*#__PURE__*/React.createElement("tbody", null, comp.slice(0, 15).map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.id
  }, /*#__PURE__*/React.createElement("td", null, r.number), /*#__PURE__*/React.createElement("td", null, r.complaint_date), /*#__PURE__*/React.createElement("td", null, r.severity), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge " + (r.status === "OPEN" ? "warn" : "ok")
  }, r.status)), /*#__PURE__*/React.createElement("td", null, r.description)))))));
}

// ---- masters: parties -----------------------------------------------------
function PartyPage({
  kind
}) {
  // kind: "customers" | "suppliers"
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({
    code: "",
    name: "",
    gstin: "",
    state_code: ""
  });
  const load = useCallback(() => api(`/api/masters/${kind}`).then(setRows).catch(e => setErr(e.message)), [kind]);
  useEffect(() => {
    load();
  }, [load]);
  const add = async e => {
    e.preventDefault();
    setErr("");
    try {
      await api(`/api/masters/${kind}`, {
        method: "POST",
        body: f
      });
      setF({
        code: "",
        name: "",
        gstin: "",
        state_code: ""
      });
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };
  const title = kind === "customers" ? "customer" : "supplier";
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Panel, {
    title: "Add " + title
  }, /*#__PURE__*/React.createElement("form", {
    className: "row",
    onSubmit: add
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Code"), /*#__PURE__*/React.createElement("input", {
    required: true,
    value: f.code,
    onChange: e => setF({
      ...f,
      code: e.target.value
    }),
    placeholder: kind === "customers" ? "CUST-01" : "SUP-01"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Name"), /*#__PURE__*/React.createElement("input", {
    required: true,
    value: f.name,
    onChange: e => setF({
      ...f,
      name: e.target.value
    }),
    placeholder: "Legal name"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "GSTIN"), /*#__PURE__*/React.createElement("input", {
    value: f.gstin,
    onChange: e => setF({
      ...f,
      gstin: e.target.value
    }),
    placeholder: "03ABCDE1234F1Z5"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "State code"), /*#__PURE__*/React.createElement("input", {
    value: f.state_code,
    onChange: e => setF({
      ...f,
      state_code: e.target.value
    }),
    placeholder: "03",
    style: {
      width: 70
    }
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Add")), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err)), /*#__PURE__*/React.createElement(Panel, {
    title: title.charAt(0).toUpperCase() + title.slice(1) + "s"
  }, !rows ? "Loading…" : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Code"), /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", null, "GSTIN"), /*#__PURE__*/React.createElement("th", null, "State"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.id
  }, /*#__PURE__*/React.createElement("td", null, r.code), /*#__PURE__*/React.createElement("td", null, r.name), /*#__PURE__*/React.createElement("td", null, r.gstin || "-"), /*#__PURE__*/React.createElement("td", null, r.state_code || "-")))))));
}

// ---- transactions: purchase (GRN) -----------------------------------------
function Purchase() {
  const suppliers = useList("/api/masters/suppliers");
  const chemicals = useList("/api/masters/chemicals");
  const warehouses = useList("/api/masters/warehouses");
  const taxes = useList("/api/masters/tax-codes");
  const [hdr, setHdr] = useState({
    supplier_id: "",
    number: genNo("GRN"),
    grn_date: new Date().toISOString().slice(0, 10)
  });
  const [lines, setLines] = useState([{
    chemical_id: "",
    warehouse_id: "",
    qty: "",
    unit_cost: "",
    tax_code_id: ""
  }]);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => j === i ? {
    ...l,
    [k]: v
  } : l));
  const submit = async e => {
    e.preventDefault();
    setErr("");
    setRes(null);
    try {
      const body = {
        ...hdr,
        lines: lines.map(l => ({
          chemical_id: l.chemical_id,
          warehouse_id: l.warehouse_id || null,
          qty: l.qty,
          unit_cost: l.unit_cost,
          tax_code_id: l.tax_code_id || null
        }))
      };
      const r = await api("/api/procurement/grn", {
        method: "POST",
        body
      });
      setRes(r);
      setHdr({
        ...hdr,
        number: genNo("GRN")
      });
      setLines([{
        chemical_id: "",
        warehouse_id: "",
        qty: "",
        unit_cost: "",
        tax_code_id: ""
      }]);
    } catch (ex) {
      setErr(ex.message);
    }
  };
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Goods Receipt Note (chemical / dye purchase)"
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("div", {
    className: "row mb"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Supplier"), /*#__PURE__*/React.createElement(Opts, {
    items: suppliers,
    value: hdr.supplier_id,
    onChange: e => setHdr({
      ...hdr,
      supplier_id: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "GRN number"), /*#__PURE__*/React.createElement("input", {
    value: hdr.number,
    onChange: e => setHdr({
      ...hdr,
      number: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: hdr.grn_date,
    onChange: e => setHdr({
      ...hdr,
      grn_date: e.target.value
    })
  }))), /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Chemical"), /*#__PURE__*/React.createElement("th", null, "Warehouse"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Qty"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Unit cost"), /*#__PURE__*/React.createElement("th", null, "Tax"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, lines.map((l, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Opts, {
    items: chemicals,
    value: l.chemical_id,
    onChange: e => setLine(i, "chemical_id", e.target.value)
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Opts, {
    items: warehouses,
    value: l.warehouse_id,
    onChange: e => setLine(i, "warehouse_id", e.target.value),
    placeholder: "\u2014"
  })), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      width: 90
    },
    value: l.qty,
    onChange: e => setLine(i, "qty", e.target.value)
  })), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      width: 100
    },
    value: l.unit_cost,
    onChange: e => setLine(i, "unit_cost", e.target.value)
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Opts, {
    items: taxes,
    value: l.tax_code_id,
    onChange: e => setLine(i, "tax_code_id", e.target.value),
    placeholder: "\u2014"
  })), /*#__PURE__*/React.createElement("td", null, lines.length > 1 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sec",
    onClick: () => setLines(ls => ls.filter((_, j) => j !== i))
  }, "\u2715")))))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sec",
    onClick: () => setLines(ls => [...ls, {
      chemical_id: "",
      warehouse_id: "",
      qty: "",
      unit_cost: "",
      tax_code_id: ""
    }])
  }, "+ Add line"), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Post GRN")), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err)), /*#__PURE__*/React.createElement(Result, {
    r: res
  }));
}

// ---- transactions: knitting production ------------------------------------
function Knitting() {
  const machines = useList("/api/masters/machines?machine_type=KNITTING");
  const yarns = useList("/api/masters/yarns");
  const fabrics = useList("/api/masters/fabric-types");
  const warehouses = useList("/api/masters/warehouses");
  const orders = useList("/api/masters/sales-orders");
  const [h, setH] = useState({
    number: genNo("KP"),
    machine_id: "",
    yarn_id: "",
    fabric_type_id: "",
    sales_order_id: "",
    production_date: new Date().toISOString().slice(0, 10),
    produced_kg: "",
    yarn_consumed_kg: "",
    wastage_kg: "0"
  });
  const [rolls, setRolls] = useState([{
    roll_no: "",
    weight_kg: "",
    warehouse_id: ""
  }]);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const setRoll = (i, k, v) => setRolls(rs => rs.map((r, j) => j === i ? {
    ...r,
    [k]: v
  } : r));
  const submit = async e => {
    e.preventDefault();
    setErr("");
    setRes(null);
    try {
      const body = {
        ...h,
        sales_order_id: h.sales_order_id || null,
        fabric_type_id: h.fabric_type_id || null,
        rolls: rolls.map(r => ({
          roll_no: r.roll_no,
          weight_kg: r.weight_kg,
          warehouse_id: r.warehouse_id || null
        }))
      };
      const r = await api("/api/knitting/production", {
        method: "POST",
        body
      });
      setRes(r);
      setH({
        ...h,
        number: genNo("KP")
      });
      setRolls([{
        roll_no: "",
        weight_kg: "",
        warehouse_id: ""
      }]);
    } catch (ex) {
      setErr(ex.message);
    }
  };
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Knitting production (issues yarn, creates greige rolls)"
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("div", {
    className: "row mb"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Doc number"), /*#__PURE__*/React.createElement("input", {
    value: h.number,
    onChange: e => setH({
      ...h,
      number: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Machine"), /*#__PURE__*/React.createElement(Opts, {
    items: machines,
    value: h.machine_id,
    onChange: e => setH({
      ...h,
      machine_id: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Yarn"), /*#__PURE__*/React.createElement(Opts, {
    items: yarns,
    value: h.yarn_id,
    onChange: e => setH({
      ...h,
      yarn_id: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Fabric type"), /*#__PURE__*/React.createElement(Opts, {
    items: fabrics,
    value: h.fabric_type_id,
    onChange: e => setH({
      ...h,
      fabric_type_id: e.target.value
    }),
    placeholder: "\u2014"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Sales order"), /*#__PURE__*/React.createElement(Opts, {
    items: orders,
    value: h.sales_order_id,
    onChange: e => setH({
      ...h,
      sales_order_id: e.target.value
    }),
    placeholder: "\u2014"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "row mb"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: h.production_date,
    onChange: e => setH({
      ...h,
      production_date: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Produced (kg)"), /*#__PURE__*/React.createElement("input", {
    value: h.produced_kg,
    onChange: e => setH({
      ...h,
      produced_kg: e.target.value
    }),
    placeholder: "250"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Yarn consumed (kg)"), /*#__PURE__*/React.createElement("input", {
    value: h.yarn_consumed_kg,
    onChange: e => setH({
      ...h,
      yarn_consumed_kg: e.target.value
    }),
    placeholder: "255"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Wastage (kg)"), /*#__PURE__*/React.createElement("input", {
    value: h.wastage_kg,
    onChange: e => setH({
      ...h,
      wastage_kg: e.target.value
    }),
    placeholder: "5"
  }))), /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Roll no."), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Weight (kg)"), /*#__PURE__*/React.createElement("th", null, "Warehouse"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, rolls.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
    value: r.roll_no,
    onChange: e => setRoll(i, "roll_no", e.target.value),
    placeholder: "R-0001"
  })), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      width: 100
    },
    value: r.weight_kg,
    onChange: e => setRoll(i, "weight_kg", e.target.value)
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Opts, {
    items: warehouses,
    value: r.warehouse_id,
    onChange: e => setRoll(i, "warehouse_id", e.target.value),
    placeholder: "\u2014"
  })), /*#__PURE__*/React.createElement("td", null, rolls.length > 1 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sec",
    onClick: () => setRolls(rs => rs.filter((_, j) => j !== i))
  }, "\u2715")))))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sec",
    onClick: () => setRolls(rs => [...rs, {
      roll_no: "",
      weight_kg: "",
      warehouse_id: ""
    }])
  }, "+ Add roll"), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Record production")), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err)), /*#__PURE__*/React.createElement(Result, {
    r: res
  }));
}

// ---- transactions: sales invoice ------------------------------------------
function Sales() {
  const customers = useList("/api/masters/customers");
  const taxes = useList("/api/masters/tax-codes");
  const [hdr, setHdr] = useState({
    customer_id: "",
    number: genNo("INV"),
    invoice_date: new Date().toISOString().slice(0, 10)
  });
  const [lines, setLines] = useState([{
    description: "",
    qty: "",
    rate: "",
    tax_code_id: ""
  }]);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => j === i ? {
    ...l,
    [k]: v
  } : l));
  const submit = async e => {
    e.preventDefault();
    setErr("");
    setRes(null);
    try {
      const body = {
        ...hdr,
        lines: lines.map(l => ({
          description: l.description,
          qty: l.qty,
          rate: l.rate,
          tax_code_id: l.tax_code_id || null
        }))
      };
      const r = await api("/api/sales/invoices", {
        method: "POST",
        body
      });
      setRes(r);
      setHdr({
        ...hdr,
        number: genNo("INV")
      });
      setLines([{
        description: "",
        qty: "",
        rate: "",
        tax_code_id: ""
      }]);
    } catch (ex) {
      setErr(ex.message);
    }
  };
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Sales invoice (with GST)"
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("div", {
    className: "row mb"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Customer"), /*#__PURE__*/React.createElement(Opts, {
    items: customers,
    value: hdr.customer_id,
    onChange: e => setHdr({
      ...hdr,
      customer_id: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Invoice number"), /*#__PURE__*/React.createElement("input", {
    value: hdr.number,
    onChange: e => setHdr({
      ...hdr,
      number: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: hdr.invoice_date,
    onChange: e => setHdr({
      ...hdr,
      invoice_date: e.target.value
    })
  }))), /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Description"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Qty"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Rate"), /*#__PURE__*/React.createElement("th", null, "Tax"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, lines.map((l, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
    style: {
      width: 260
    },
    value: l.description,
    onChange: e => setLine(i, "description", e.target.value),
    placeholder: "Dyed fabric"
  })), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      width: 90
    },
    value: l.qty,
    onChange: e => setLine(i, "qty", e.target.value)
  })), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      width: 90
    },
    value: l.rate,
    onChange: e => setLine(i, "rate", e.target.value)
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Opts, {
    items: taxes,
    value: l.tax_code_id,
    onChange: e => setLine(i, "tax_code_id", e.target.value),
    placeholder: "\u2014"
  })), /*#__PURE__*/React.createElement("td", null, lines.length > 1 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sec",
    onClick: () => setLines(ls => ls.filter((_, j) => j !== i))
  }, "\u2715")))))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn sec",
    onClick: () => setLines(ls => [...ls, {
      description: "",
      qty: "",
      rate: "",
      tax_code_id: ""
    }])
  }, "+ Add line"), /*#__PURE__*/React.createElement("button", {
    className: "btn"
  }, "Post invoice")), err && /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err)), /*#__PURE__*/React.createElement(Result, {
    r: res
  }));
}

// ---- transactions: dyeing (batch -> bath -> dispense -> register) ----------
function Dyeing() {
  const shades = useList("/api/masters/shades");
  const machines = useList("/api/masters/machines?machine_type=DYEING");
  const versions = useList("/api/masters/recipe-versions");
  const [batch, setBatch] = useState(null);
  const [bath, setBath] = useState(null);
  const [order, setOrder] = useState(null);
  const [disp, setDisp] = useState(null);
  const [reg, setReg] = useState(null);
  const [err, setErr] = useState("");
  const [bf, setBf] = useState({
    batch_code: genNo("DY"),
    fabric_kg: "250",
    shade_id: ""
  });
  const [hf, setHf] = useState({
    bath_code: "",
    machine_id: "",
    recipe_version_id: "",
    fabric_kg: "250"
  });
  const go = async fn => {
    setErr("");
    try {
      await fn();
    } catch (ex) {
      setErr(ex.message);
    }
  };
  const createBatch = () => go(async () => {
    const r = await api("/api/dyeing/batches", {
      method: "POST",
      body: bf
    });
    setBatch(r);
    setHf({
      ...hf,
      bath_code: r.batch_code + "-B01",
      fabric_kg: bf.fabric_kg
    });
  });
  const createBath = () => go(async () => {
    const r = await api("/api/dyeing/baths", {
      method: "POST",
      body: {
        ...hf,
        batch_id: batch.batch_id
      }
    });
    setBath(r);
    setOrder(null);
    setDisp(null);
    setReg(null);
  });
  const preview = () => go(async () => setOrder(await api(`/api/dyeing/baths/${bath.bath_id}/dose-order`)));
  const dispense = () => go(async () => {
    setDisp(await api(`/api/dyeing/baths/${bath.bath_id}/simulate-dispense`, {
      method: "POST"
    }));
    setReg(await api(`/api/dyeing/baths/${bath.bath_id}/consumption-register`));
  });
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Panel, {
    title: "1 \xB7 Create dye batch"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Batch code"), /*#__PURE__*/React.createElement("input", {
    value: bf.batch_code,
    onChange: e => setBf({
      ...bf,
      batch_code: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Fabric (kg)"), /*#__PURE__*/React.createElement("input", {
    value: bf.fabric_kg,
    onChange: e => setBf({
      ...bf,
      fabric_kg: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Shade"), /*#__PURE__*/React.createElement(Opts, {
    items: shades,
    value: bf.shade_id,
    onChange: e => setBf({
      ...bf,
      shade_id: e.target.value
    })
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: createBatch
  }, "Create batch")), batch && /*#__PURE__*/React.createElement("div", {
    className: "muted",
    style: {
      marginTop: 10
    }
  }, "Batch ", batch.batch_code, " created \u2713")), batch && /*#__PURE__*/React.createElement(Panel, {
    title: "2 \xB7 Add bath (approved recipe)"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Bath code"), /*#__PURE__*/React.createElement("input", {
    value: hf.bath_code,
    onChange: e => setHf({
      ...hf,
      bath_code: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Machine"), /*#__PURE__*/React.createElement(Opts, {
    items: machines,
    value: hf.machine_id,
    onChange: e => setHf({
      ...hf,
      machine_id: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Recipe version"), /*#__PURE__*/React.createElement(Opts, {
    items: versions,
    value: hf.recipe_version_id,
    onChange: e => setHf({
      ...hf,
      recipe_version_id: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "Fabric (kg)"), /*#__PURE__*/React.createElement("input", {
    value: hf.fabric_kg,
    onChange: e => setHf({
      ...hf,
      fabric_kg: e.target.value
    })
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: createBath
  }, "Create bath")), bath && /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      alignSelf: "center"
    }
  }, "Bath ", bath.bath_code, " \u2713"), /*#__PURE__*/React.createElement("button", {
    className: "btn sec",
    onClick: preview
  }, "Preview dose order"), /*#__PURE__*/React.createElement("button", {
    className: "btn",
    onClick: dispense
  }, "Simulate dispensing"))), order && /*#__PURE__*/React.createElement(Panel, {
    title: "Scaled dose order (ERP \u2192 Color Service)"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Seq"), /*#__PURE__*/React.createElement("th", null, "Material"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Target (kg)"), /*#__PURE__*/React.createElement("th", null, "Dye?"))), /*#__PURE__*/React.createElement("tbody", null, order.materials.map((m, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, m.sequence), /*#__PURE__*/React.createElement("td", null, m.material_code), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, m.target_qty), /*#__PURE__*/React.createElement("td", null, m.is_dye ? "Dye" : "Aux")))))), disp && /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Dispensed lines",
    value: disp.processed
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Skipped (replay)",
    value: disp.skipped
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Consumption cost",
    value: inr(disp.total_cost)
  })), reg && /*#__PURE__*/React.createElement(Panel, {
    title: "Bath consumption register (recipe vs actual)"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Material"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Recipe"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Actual"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Variance"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Cost"))), /*#__PURE__*/React.createElement("tbody", null, reg.rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, r.material_code), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, r.recipe_target_kg), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, r.actual_kg), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, r.variance_kg), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(r.cost))))), /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Total"), /*#__PURE__*/React.createElement("th", null), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, reg.total_actual_kg), /*#__PURE__*/React.createElement("th", null), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, inr2(reg.total_cost)))))), err && /*#__PURE__*/React.createElement(Panel, null, /*#__PURE__*/React.createElement("div", {
    className: "err"
  }, err)));
}

// ---- costing --------------------------------------------------------------
function Costing() {
  const [cpk, errc] = useData("/api/costing/cost-per-kg");
  const custs = useList("/api/costing/customers");
  const orders = useList("/api/costing/orders");
  const machines = useList("/api/costing/machines");
  const pct = v => Number(v || 0).toFixed(1) + "%";
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Knitted cost / kg",
    value: cpk ? inr(cpk.knitted_cost_per_kg) : "…"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Dyeing cost / kg",
    value: cpk ? inr(cpk.dyeing_cost_per_kg) : "…"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Knitted output (kg)",
    value: cpk ? inr2(cpk.knitted_kg) : "…"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Dyed output (kg)",
    value: cpk ? inr2(cpk.dyed_kg) : "…"
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Customer profitability"
  }, custs.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No billed customers yet.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Customer"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Revenue"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Cost"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Gross profit"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Margin"))), /*#__PURE__*/React.createElement("tbody", null, custs.map((c, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, c.customer), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(c.revenue)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(c.cost)), /*#__PURE__*/React.createElement("td", {
    className: "num",
    style: {
      color: Number(c.gross_profit) >= 0 ? "#16a34a" : "#dc2626"
    }
  }, inr2(c.gross_profit)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, pct(c.margin_pct))))))), /*#__PURE__*/React.createElement(Panel, {
    title: "Order profitability"
  }, orders.filter(o => Number(o.revenue) || Number(o.total_cost)).length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No orders with activity yet.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Order"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Revenue"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Yarn"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Dyeing"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Total cost"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Gross profit"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Margin"))), /*#__PURE__*/React.createElement("tbody", null, orders.filter(o => Number(o.revenue) || Number(o.total_cost)).map((o, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, o.order_number), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(o.revenue)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(o.yarn_cost)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(o.dyeing_cost)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(o.total_cost)), /*#__PURE__*/React.createElement("td", {
    className: "num",
    style: {
      color: Number(o.gross_profit) >= 0 ? "#16a34a" : "#dc2626"
    }
  }, inr2(o.gross_profit)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, pct(o.margin_pct))))))), /*#__PURE__*/React.createElement(Panel, {
    title: "Machine-wise cost"
  }, machines.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No machine cost yet.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Machine"), /*#__PURE__*/React.createElement("th", null, "Type"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Cost"))), /*#__PURE__*/React.createElement("tbody", null, machines.map((m, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, m.machine), /*#__PURE__*/React.createElement("td", null, m.machine_type), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(m.cost))))))));
}

// ---- devices & labels -----------------------------------------------------
function Devices() {
  const [summary, setSummary] = useState([]);
  const [readings, setReadings] = useState([]);
  const [rolls, setRolls] = useState([]);
  const [machines, setMachines] = useState([]);
  const [scales, setScales] = useState([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    api("/api/hardware/knitting-summary").then(setSummary).catch(() => {});
    api("/api/hardware/scale-readings").then(setReadings).catch(() => {});
    api("/api/rolls").then(setRolls).catch(() => {});
    api("/api/masters/machines?machine_type=KNITTING").then(setMachines).catch(() => {});
    api("/api/hardware/scales").then(setScales).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const simKnit = async code => {
    setMsg("");
    try {
      const r = await api("/api/hardware/simulate/knitting", {
        method: "POST",
        body: {
          machine_code: code,
          samples: 4
        }
      });
      setMsg(`Ingested ${r.created} samples from ${code}`);
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };
  const simWeigh = async code => {
    setMsg("");
    try {
      const r = await api("/api/hardware/simulate/scale", {
        method: "POST",
        body: {
          scale_code: code,
          weight: (120 + Math.floor(Math.random() * 20)).toString(),
          reference_type: "ROLL",
          seq: Date.now() % 100000
        }
      });
      setMsg(`Captured weight on ${code}`);
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };
  const label = async id => {
    try {
      const blob = await api(`/api/rolls/${id}/label`, {
        blob: true
      });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(e.message);
    }
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Panel, {
    title: "Knitting machine monitoring"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row mb"
  }, machines.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    className: "btn sec",
    onClick: () => simKnit(m.code)
  }, "Simulate ", m.code))), summary.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No machine logs yet \u2014 run a simulation.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Machine"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Produced (kg)"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Run (min)"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Downtime (min)"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Stops"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Efficiency"))), /*#__PURE__*/React.createElement("tbody", null, summary.map((s, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, s.machine), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(s.produced_kg)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, s.run_minutes), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, s.downtime_minutes), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, s.stops), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, Number(s.efficiency_pct).toFixed(1), "%")))))), /*#__PURE__*/React.createElement(Panel, {
    title: "Weighing scale readings"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row mb"
  }, scales.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    className: "btn sec",
    onClick: () => simWeigh(s.code)
  }, "Capture weight \xB7 ", s.code))), readings.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No readings yet.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Reading id"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Weight"), /*#__PURE__*/React.createElement("th", null, "Ref"), /*#__PURE__*/React.createElement("th", null, "Stable"), /*#__PURE__*/React.createElement("th", null, "At"))), /*#__PURE__*/React.createElement("tbody", null, readings.slice(0, 10).map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.id
  }, /*#__PURE__*/React.createElement("td", null, r.external_reading_id), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(r.weight), " ", r.unit), /*#__PURE__*/React.createElement("td", null, r.reference_type || "-"), /*#__PURE__*/React.createElement("td", null, r.stable ? "Yes" : "No"), /*#__PURE__*/React.createElement("td", null, (r.captured_at || "").slice(0, 19).replace("T", " ")))))), msg && /*#__PURE__*/React.createElement("div", {
    className: "muted",
    style: {
      marginTop: 10
    }
  }, msg)), /*#__PURE__*/React.createElement(Panel, {
    title: "Fabric roll labels (QR)"
  }, rolls.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "muted"
  }, "No rolls yet \u2014 record a knitting production.") : /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Roll no."), /*#__PURE__*/React.createElement("th", null, "Kind"), /*#__PURE__*/React.createElement("th", {
    className: "num"
  }, "Weight"), /*#__PURE__*/React.createElement("th", null, "Quality"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, rolls.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.id
  }, /*#__PURE__*/React.createElement("td", null, r.roll_no), /*#__PURE__*/React.createElement("td", null, r.kind), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, inr2(r.weight_kg), " kg"), /*#__PURE__*/React.createElement("td", null, r.quality_status), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sec",
    onClick: () => label(r.id)
  }, "Print label"))))))));
}

// ---- shell ----------------------------------------------------------------
const PAGES = {
  owner: {
    t: "Owner Dashboard",
    c: OwnerDash
  },
  factory: {
    t: "Factory Dashboard",
    c: FactoryDash
  },
  accounts: {
    t: "Accounts Dashboard",
    c: AccountsDash
  },
  chemical: {
    t: "Chemical Dashboard",
    c: ChemicalDash
  },
  purchase: {
    t: "Purchase (GRN)",
    c: Purchase
  },
  knitting: {
    t: "Knitting Production",
    c: Knitting
  },
  sales: {
    t: "Sales Invoice",
    c: Sales
  },
  dyeing: {
    t: "Dyeing & Dispensing",
    c: Dyeing
  },
  customers: {
    t: "Customers",
    c: () => /*#__PURE__*/React.createElement(PartyPage, {
      kind: "customers"
    })
  },
  suppliers: {
    t: "Suppliers",
    c: () => /*#__PURE__*/React.createElement(PartyPage, {
      kind: "suppliers"
    })
  },
  warehouses: {
    t: "Warehouses",
    c: Warehouses
  },
  quality: {
    t: "Quality & Finishing",
    c: Quality
  },
  costing: {
    t: "Costing & Profitability",
    c: Costing
  },
  devices: {
    t: "Devices & Labels",
    c: Devices
  },
  reports: {
    t: "Reports",
    c: Reports
  }
};
function App() {
  const [page, setPage] = useState("owner");
  const [me, setMe] = useState(null);
  useEffect(() => {
    api("/api/auth/me").then(setMe).catch(() => {});
  }, []);
  const Cur = PAGES[page].c;
  const navBtn = (id, label) => /*#__PURE__*/React.createElement("button", {
    className: page === id ? "active" : "",
    onClick: () => setPage(id)
  }, label);
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, "Textile ERP", /*#__PURE__*/React.createElement("small", null, "Knitting & Dyeing")), /*#__PURE__*/React.createElement("nav", {
    className: "nav"
  }, /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Dashboards"), navBtn("owner", "Owner"), navBtn("factory", "Factory"), navBtn("accounts", "Accounts"), navBtn("chemical", "Chemical"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Transactions"), navBtn("purchase", "Purchase (GRN)"), navBtn("knitting", "Knitting"), navBtn("sales", "Sales Invoice"), navBtn("dyeing", "Dyeing & Dispensing"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Masters"), navBtn("customers", "Customers"), navBtn("suppliers", "Suppliers"), navBtn("warehouses", "Warehouses"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Quality"), navBtn("quality", "Quality"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Costing"), navBtn("costing", "Costing"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Devices"), navBtn("devices", "Devices & Labels"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Reports"), navBtn("reports", "Reports"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Session"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setToken(null);
      location.reload();
    }
  }, "Log out"))), /*#__PURE__*/React.createElement("div", {
    className: "main"
  }, /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("h1", null, PAGES[page].t), /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, me ? me.full_name || me.username : "", " \xB7 ", new Date().toLocaleDateString("en-IN"))), /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement(Cur, null))));
}
function Root() {
  const [authed, setAuthed] = useState(!!getToken());
  return authed ? /*#__PURE__*/React.createElement(App, null) : /*#__PURE__*/React.createElement(Login, {
    onLogin: () => setAuthed(true)
  });
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(Root, null));