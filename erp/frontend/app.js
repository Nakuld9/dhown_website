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
  warehouses: {
    t: "Warehouses",
    c: Warehouses
  },
  quality: {
    t: "Quality & Finishing",
    c: Quality
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
  }, "Masters"), navBtn("warehouses", "Warehouses"), /*#__PURE__*/React.createElement("div", {
    className: "group"
  }, "Quality"), navBtn("quality", "Quality"), /*#__PURE__*/React.createElement("div", {
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