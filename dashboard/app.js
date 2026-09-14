/* ============================================================
   TopMotive Aftermarket Basket Dashboard
   Pure vanilla JS + SVG/HTML charts (no external dependencies),
   so the report runs offline straight from index.html.
   Data is provided by data.js  ->  window.TM_DATA
   ============================================================ */
(function () {
"use strict";

const D = window.TM_DATA;
if (!D) { document.getElementById("page").innerHTML =
  '<div class="empty">data.js not found. Run <code>python3 build_data.py</code> first.</div>'; return; }

/* ---- dimension lookups ---------------------------------- */
const GEN   = D.dims.genart;           // [{code,label}]
const PER   = D.dims.period;           // ["2026/1", ...]
const MKT   = D.dims.market;           // [{code,label,region}]
const BRD   = D.dims.brand;            // [{name,ours,agg}]
const NART  = D.dims.nartnr || [];     // part numbers (dictionary-encoded)
const OURS  = BRD.map(b => b.ours);
const AGG   = BRD.map(b => !!b.agg);   // aggregate (e.g. Eigenmarken): counts in
                                       // totals but excluded from named-brand views
const COL = { G:0, P:1, M:2, B:3, Q:4 };          // brandFacts columns
const AC  = { G:0, P:1, M:2, B:3, N:4, Q:5 };     // articleFacts columns

// Pre-index article facts by genart so per-genart views never scan all rows.
const ARTICLE_BY_GENART = (() => {
  const m = new Map();
  for (const r of D.articleFacts) {
    let a = m.get(r[AC.G]); if (!a) { a = []; m.set(r[AC.G], a); }
    a.push(r);
  }
  return m;
})();

const COLORS = { ours: "#1f6fd0", comp: "#19b3a6", compSoft: "#7fd0c8", gold: "#e8a33d" };

// Sentinel market for quarters delivered without a country split, and the set
// of periods that DO carry a cluster/country breakdown.
const NOGEO_M = MKT.findIndex(m => m.noGeo);
const GEO_PERIODS = new Set(D.geoPeriods || []);
const periodHasGeo = p => GEO_PERIODS.has(PER[p]);

/* ---- state ---------------------------------------------- */
const state = {
  tab: "overview",
  period: PER.length - 1,                 // latest quarter
  genart: D.articleGenarts.length ? GEN.findIndex(g => g.code === D.articleGenarts[0]) : 0,
  markets: null,                          // null = All; else Set of indices
  brands: null,                           // null = All; else Set of indices
  focusMarket: null,                      // article tab: market index in focus
};
if (state.genart < 0) state.genart = 0;
// default to the latest period that actually has data for the default genart
// (data is sparse: newer quarters cover only some generic articles)
(function () {
  let latest = -1;
  for (const r of D.brandFacts) if (r[0] === state.genart && r[1] > latest) latest = r[1];
  if (latest >= 0) state.period = latest;
})();

// GENART can be a single index, or ALL_GEN to aggregate across every generic
// article (only "all together" or a single one is selectable - never a pair).
const ALL_GEN = "ALL";
const genartMatch = g => state.genart === ALL_GEN || g === state.genart;
const genartLabel = () => state.genart === ALL_GEN ? "All Generic Articles" : GEN[state.genart].label;

/* ---- number formatting ---------------------------------- */
const fmt = n => {
  n = +n || 0;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};
const fmtFull = n => (+n || 0).toLocaleString("en-US");
const pct = (x, t) => t ? (100 * x / t) : 0;
const pctS = (x, t, d = 1) => pct(x, t).toFixed(d) + "%";

/* ============================================================
   Tooltip
   ============================================================ */
const tip = document.getElementById("tooltip");
function showTip(html, e) { tip.innerHTML = html; tip.style.display = "block"; moveTip(e); }
function moveTip(e) {
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth) x = e.clientX - w - pad;
  if (y + h > innerHeight) y = e.clientY - h - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { tip.style.display = "none"; }

/* ============================================================
   Filtering / aggregation
   ============================================================ */
function brandPass(r) {
  if (r[COL.P] !== state.period) return false;
  if (!genartMatch(r[COL.G])) return false;
  if (state.markets && !state.markets.has(r[COL.M])) return false;
  if (state.brands && !state.brands.has(r[COL.B])) return false;
  return true;
}
function articlePass(r) {
  if (r[AC.P] !== state.period) return false;
  if (!genartMatch(r[AC.G])) return false;
  if (state.markets && !state.markets.has(r[AC.M])) return false;
  if (state.brands && !state.brands.has(r[AC.B])) return false;
  return true;
}
function brandRows()   { return D.brandFacts.filter(brandPass); }
function articleRows() {
  const src = state.genart === ALL_GEN ? D.articleFacts : (ARTICLE_BY_GENART.get(state.genart) || []);
  return src.filter(articlePass);
}

// ZF-share movement per product line across the whole window, IGNORING all
// slicers (period / genart / market). Returns [{gi, d, firstP, lastP}] sorted
// by change desc. Used by the Overview "portfolio movers" cards.
function portfolioMovers() {
  return GEN.map((g, gi) => {
    const tot = PER.map(() => 0), ourq = PER.map(() => 0);
    for (const r of D.brandFacts) {
      if (r[COL.G] !== gi) continue;
      tot[r[COL.P]] += r[COL.Q]; if (OURS[r[COL.B]]) ourq[r[COL.P]] += r[COL.Q];
    }
    const w = PER.map((p, pi) => pi).filter(pi => tot[pi] > 0);
    if (w.length < 2) return null;
    return { gi, d: pct(ourq[w[w.length - 1]], tot[w[w.length - 1]]) - pct(ourq[w[0]], tot[w[0]]),
             firstP: w[0], lastP: w[w.length - 1] };
  }).filter(Boolean).sort((a, z) => z.d - a.d);
}

// sum qty grouped by a column index -> Map(key -> qty)
function sumBy(rows, idx, qIdx) {
  const m = new Map();
  for (const r of rows) m.set(r[idx], (m.get(r[idx]) || 0) + r[qIdx]);
  return m;
}

// Top named articles (aggregate brands such as Eigenmarken / the dummy part
// number are excluded). Returns [{n:nartnrIdx, b:brandIdx, q}] sorted desc.
function topArticles(rows, n) {
  const byArt = new Map();
  for (const r of rows) {
    if (AGG[r[AC.B]]) continue;
    const key = r[AC.N] * 100000 + r[AC.B];
    byArt.set(key, (byArt.get(key) || 0) + r[AC.Q]);
  }
  const arr = [...byArt.entries()]
    .map(([k, q]) => ({ n: Math.floor(k / 100000), b: k % 100000, q }))
    .sort((a, z) => z.q - a.q);
  return n ? arr.slice(0, n) : arr;   // no arg => full list (used for the distinct count)
}

// Brand-level KPIs over a set of rows.
// Totals (total / ours / comp) include EVERY brand, incl. the Eigenmarken
// aggregate, so they reconcile with the source files. Named-brand views
// (ranked / leader / rank) exclude aggregate brands.
function brandStats(rows) {
  const byBrand = sumBy(rows, COL.B, COL.Q);
  let total = 0, ours = 0, agg = 0;
  byBrand.forEach((q, b) => { total += q; if (OURS[b]) ours += q; if (AGG[b]) agg += q; });
  // named-brand ranking (aggregate brands excluded)
  const ranked = [...byBrand.entries()]
    .filter(([b]) => !AGG[b])
    .map(([b, q]) => ({ b, name: BRD[b].name, ours: OURS[b], q }))
    .sort((a, z) => z.q - a.q);
  ranked.forEach((d, i) => d.rank = i + 1);
  // our group as one entity, ranked among competitor (non-our, non-agg) brands
  const ourGroupRank = ranked.filter(d => !d.ours && d.q > ours).length + 1;
  const leader = ranked[0] || null;
  return { byBrand, ranked, total, ours, comp: total - ours, agg, ourGroupRank, leader };
}

/* ============================================================
   Generic chart helpers
   ============================================================ */
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function panel(title, sub) {
  const p = el("div", "panel");
  if (title) p.appendChild(el("h3", null, title));
  if (sub) p.appendChild(el("p", "sub", sub));
  return p;
}

// Horizontal bar list. items: [{label, value, ours, tipHtml}]
function hbars(container, items, opts = {}) {
  const max = opts.max || Math.max(1, ...items.map(i => i.value));
  const wrap = el("div", "hbars");
  if (!items.length) { container.appendChild(el("div", "empty", "No data for current selection.")); return; }
  for (const it of items) {
    const row = el("div", "hbar-row");
    const lab = el("div", "hbar-label");
    lab.innerHTML = it.ours ? `<span class="ours-tag">${esc(it.label)}</span>` : esc(it.label);
    lab.title = it.label;
    const track = el("div", "hbar-track");
    const w = Math.max(1.5, pct(it.value, max));
    const fill = el("div", "hbar-fill");
    fill.style.width = w + "%";
    fill.style.background = it.color || (it.ours ? COLORS.ours : COLORS.comp);
    // Value label is absolutely positioned and anchored to the bar's right end.
    // A post-render pass (adjustBarLabels) flips it outside the bar when it
    // would not fit, so the number always sits next to its bar.
    const val = el("span", "hbar-val inside", opts.valFmt ? opts.valFmt(it) : fmt(it.value));
    val.dataset.w = w;
    val.style.right = `calc(${100 - w}% + 8px)`;
    track.appendChild(fill); track.appendChild(val);
    row.appendChild(lab); row.appendChild(track);
    if (it.tipHtml) {
      row.addEventListener("mousemove", e => showTip(it.tipHtml, e));
      row.addEventListener("mouseleave", hideTip);
    }
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}

// 100% stacked rows (ours vs competition). rows:[{label, ours, comp, tipHtml}]
function stack100(container, rows) {
  const wrap = el("div", "stack100");
  if (!rows.length) { container.appendChild(el("div", "empty", "No data.")); return; }
  for (const r of rows) {
    const tot = r.ours + r.comp;
    const op = pct(r.ours, tot), cp = 100 - op;
    const row = el("div", "s100-row");
    const lab = el("div", "s100-label", esc(r.label)); lab.title = r.label;
    const track = el("div", "s100-track");
    const so = el("div", "s100-seg ours"); so.style.width = op + "%";
    if (op > 11) so.textContent = op.toFixed(0) + "%";
    const sc = el("div", "s100-seg comp"); sc.style.width = cp + "%";
    if (cp > 11) sc.textContent = cp.toFixed(0) + "%";
    track.appendChild(so); track.appendChild(sc);
    const tt = el("div", "s100-total", fmt(tot));
    row.appendChild(lab); row.appendChild(track); row.appendChild(tt);
    if (r.tipHtml) {
      row.addEventListener("mousemove", e => showTip(r.tipHtml, e));
      row.addEventListener("mouseleave", hideTip);
    }
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}

const SVGNS = "http://www.w3.org/2000/svg";
function svg(w, h) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("width", "100%");
  s.style.height = h + "px"; s.style.maxWidth = w + "px"; s.style.display = "block"; s.style.margin = "0 auto";
  return s;
}
function svgEl(name, attrs) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function arcPath(cx, cy, r, a0, a1) {
  const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  return `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${large} 1 ${p1[0]} ${p1[1]}`;
}

// Donut: segments [{label,value,color}], centerBig, centerSub
function donut(container, segments, centerBig, centerSub) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const W = 230, H = 230, cx = W / 2, cy = H / 2, R = 95, r = 60, sw = R - r;
  const s = svg(W, H);
  let a = -Math.PI / 2;
  if (total <= 0) {
    s.appendChild(svgEl("circle", { cx, cy, r: (R + r) / 2, fill: "none", stroke: "#e6edf2", "stroke-width": sw }));
  }
  for (const seg of segments) {
    if (seg.value <= 0) continue;
    const a1 = a + 2 * Math.PI * (seg.value / total);
    const path = svgEl("path", {
      d: arcPath(cx, cy, (R + r) / 2, a + 0.004, a1 - 0.004),
      fill: "none", stroke: seg.color, "stroke-width": sw
    });
    path.style.cursor = "default";
    path.addEventListener("mousemove", e => showTip(
      `<b>${esc(seg.label)}</b><br>${fmtFull(seg.value)} positions · ${pctS(seg.value, total)}`, e));
    path.addEventListener("mouseleave", hideTip);
    s.appendChild(path);
    a = a1;
  }
  const t1 = svgEl("text", { x: cx, y: cy - 2, "text-anchor": "middle", class: "donut-center-big" });
  t1.textContent = centerBig;
  const t2 = svgEl("text", { x: cx, y: cy + 16, "text-anchor": "middle", class: "donut-center-sub" });
  t2.textContent = centerSub || "";
  s.appendChild(t1); s.appendChild(t2);
  const wrap = el("div", "donut-wrap");
  wrap.appendChild(s);
  // legend
  const lg = el("div");
  for (const seg of segments) {
    const it = el("div", "legend");
    it.style.marginBottom = "8px";
    it.innerHTML = `<span class="item"><span class="dot" style="background:${seg.color}"></span>
      ${esc(seg.label)} &nbsp;<b style="color:var(--navy)">${pctS(seg.value, total)}</b></span>`;
    lg.appendChild(it);
  }
  wrap.appendChild(lg);
  container.appendChild(wrap);
}

// Vertical stacked columns (region). cats:[{label, ours, comp}]
function stackedColumns(container, cats) {
  if (!cats.length) { container.appendChild(el("div", "empty", "No data.")); return; }
  const W = Math.max(360, cats.length * 96 + 60), H = 250;
  const padB = 46, padT = 26, padL = 44, plotH = H - padB - padT;
  const max = Math.max(1, ...cats.map(c => c.ours + c.comp));
  const s = svg(W, H);
  // y gridlines
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH * (i / 4);
    s.appendChild(svgEl("line", { x1: padL, y1: y, x2: W - 12, y2: y, stroke: "#eef2f5", "stroke-width": 1 }));
    const tx = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10, fill: "#8a99a8" });
    tx.textContent = fmt(max * (1 - i / 4)); s.appendChild(tx);
  }
  const bw = Math.min(64, (W - padL - 20) / cats.length - 22);
  cats.forEach((c, i) => {
    const x = padL + 12 + i * ((W - padL - 24) / cats.length) + ((W - padL - 24) / cats.length - bw) / 2;
    const tot = c.ours + c.comp;
    const hO = plotH * (c.ours / max), hC = plotH * (c.comp / max);
    const yC = padT + plotH - hC, yO = yC - hO;
    const rectC = svgEl("rect", { x, y: yC, width: bw, height: Math.max(0, hC), fill: COLORS.comp });
    const rectO = svgEl("rect", { x, y: yO, width: bw, height: Math.max(0, hO), fill: COLORS.ours });
    [["Competition", c.comp, rectC], ["Our Brands", c.ours, rectO]].forEach(([nm, v, rect]) => {
      rect.addEventListener("mousemove", e => showTip(
        `<b>${esc(c.label)}</b><br>${nm}: ${fmtFull(v)} · ${pctS(v, tot)}`, e));
      rect.addEventListener("mouseleave", hideTip);
      s.appendChild(rect);
    });
    // total label
    const tl = svgEl("text", { x: x + bw / 2, y: yO - 6, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#2b3a4a" });
    tl.textContent = fmt(tot); s.appendChild(tl);
    // ours share inside
    if (hO > 16) {
      const ol = svgEl("text", { x: x + bw / 2, y: yO + hO / 2 + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#fff" });
      ol.textContent = pct(c.ours, tot).toFixed(0) + "%"; s.appendChild(ol);
    }
    // category label
    const cl = svgEl("text", { x: x + bw / 2, y: H - 16, "text-anchor": "middle", "font-size": 11, fill: "#3a4a5a" });
    cl.textContent = c.label.length > 14 ? c.label.slice(0, 13) + "…" : c.label; s.appendChild(cl);
  });
  container.appendChild(s);
}

// Line chart for trend. series:[{name,color,points:[{x,y}]}], xLabels[]
function lineChart(container, xLabels, series, opts = {}) {
  const yFmt = opts.yFmt || fmt;
  const endLabels = opts.endLabels;                 // 'all' | 'ours' | false
  const rightPad = endLabels ? 58 : 24;
  const W = Math.max(420, xLabels.length * 120 + 80), H = 280;
  const padB = 40, padT = 20, padL = 52, plotH = H - padB - padT, plotW = W - padL - rightPad;
  const max = Math.max(1, ...series.flatMap(s => s.points.map(p => p.y)));
  const s = svg(W, H);
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH * (i / 4);
    s.appendChild(svgEl("line", { x1: padL, y1: y, x2: W - 12, y2: y, stroke: "#eef2f5" }));
    const tx = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10, fill: "#8a99a8" });
    tx.textContent = yFmt(max * (1 - i / 4)); s.appendChild(tx);
  }
  const X = i => padL + (xLabels.length === 1 ? plotW / 2 : plotW * i / (xLabels.length - 1));
  const Y = v => padT + plotH * (1 - v / max);
  xLabels.forEach((lab, i) => {
    const tx = svgEl("text", { x: X(i), y: H - 14, "text-anchor": "middle", "font-size": 11, fill: "#3a4a5a" });
    tx.textContent = lab; s.appendChild(tx);
  });
  for (const ser of series) {
    const sw = ser.width || 2.5;
    let d = "";
    ser.points.forEach((p, i) => { d += (i ? " L " : "M ") + X(p.x) + " " + Y(p.y); });
    if (ser.points.length > 1)
      s.appendChild(svgEl("path", { d, fill: "none", stroke: ser.color, "stroke-width": sw,
        "stroke-linejoin": "round", "stroke-linecap": "round" }));
    ser.points.forEach(p => {
      const c = svgEl("circle", { cx: X(p.x), cy: Y(p.y), r: ser.width ? 4.5 : 3.5, fill: ser.color });
      c.addEventListener("mousemove", e => showTip(`<b>${esc(ser.name)}</b><br>${xLabels[p.x]}: ${yFmt(p.y)}`, e));
      c.addEventListener("mouseleave", hideTip);
      s.appendChild(c);
    });
    // label the latest point so the current value is readable without a date picker
    if (endLabels && ser.points.length && (endLabels === "all" || ser.ours)) {
      const lp = ser.points[ser.points.length - 1];
      const t = svgEl("text", { x: X(lp.x) + 7, y: Y(lp.y) + 4, "font-size": 11,
        "font-weight": 700, fill: ser.color });
      t.textContent = yFmt(lp.y); s.appendChild(t);
    }
  }
  container.appendChild(s);
}

function legend(items) { // items:[{label,cls|color}]
  const l = el("div", "legend");
  for (const it of items) {
    const dot = it.color ? `<span class="dot" style="background:${it.color}"></span>`
                         : `<span class="dot ${it.cls}"></span>`;
    l.appendChild(el("span", "item", dot + esc(it.label)));
  }
  return l;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ============================================================
   SLICERS
   ============================================================ */
function buildSlicers() {
  const host = document.getElementById("slicers");
  host.innerHTML = "";
  const periodSlicer = singleSlicer("Reporting Period (LDATE)", PER.map((p, i) => ({ v: i, t: p })),
    state.period, v => { state.period = v; });
  periodSlicer.id = "slicer-period";
  host.appendChild(periodSlicer);
  host.appendChild(singleSlicer("Generic Article (GENART)",
    GEN.map((g, i) => ({ v: i, t: g.label + "  ·  " + g.code }))
      .concat([{ v: ALL_GEN, t: "All Generic Articles" }]), state.genart,
    v => { state.genart = v; state.focusMarket = null; }));
  host.appendChild(multiSlicer("Market / Cluster (LKZ)",
    MKT.map((m, i) => ({ v: i, t: m.label })).filter(o => o.v !== NOGEO_M), "markets"));
  host.appendChild(multiSlicer("Brand (DLNRBEZ)", BRD.map((b, i) => ({ v: i, t: b.name + (b.ours ? "  ★" : "") })), "brands"));
}

function singleSlicer(label, options, current, onPick) {
  const wrap = el("div", "slicer");
  wrap.appendChild(el("label", null, label));
  const dd = el("div", "dd");
  const btn = el("button", "dd-btn");
  const cur = options.find(o => o.v === current);
  btn.textContent = cur ? cur.t : "—";
  const menu = el("div", "dd-menu");
  options.forEach(o => {
    const item = el("div", "dd-item", esc(o.t));
    item.onclick = () => { onPick(o.v); btn.textContent = o.t; dd.classList.remove("open"); render(); };
    menu.appendChild(item);
  });
  btn.onclick = e => { e.stopPropagation(); closeAll(dd); dd.classList.toggle("open"); };
  dd.appendChild(btn); dd.appendChild(menu); wrap.appendChild(dd);
  return wrap;
}

function multiSlicer(label, options, key) {
  const wrap = el("div", "slicer");
  wrap.appendChild(el("label", null, label));
  const dd = el("div", "dd");
  const btn = el("button", "dd-btn");
  const menu = el("div", "dd-menu");
  function refreshBtn() {
    const set = state[key];
    if (!set) btn.textContent = "All";
    else if (set.size === 1) btn.textContent = options.find(o => o.v === [...set][0]).t;
    else btn.textContent = set.size + " selected";
  }
  // Select all / Clear on top
  const tools = el("div", "dd-tools");
  const all = el("button", null, "Select all"), none = el("button", null, "Clear");
  all.onclick = e => { e.stopPropagation(); state[key] = null; rebuildChecks(menu, key, options); refreshBtn(); render(); };
  none.onclick = e => { e.stopPropagation(); state[key] = new Set(); rebuildChecks(menu, key, options); refreshBtn(); render(); };
  tools.appendChild(all); tools.appendChild(none); menu.appendChild(tools);
  options.forEach(o => {
    const item = el("div", "dd-item");
    const cb = el("input"); cb.type = "checkbox";
    cb.checked = !state[key] || state[key].has(o.v);
    cb.onchange = () => {
      let set = state[key] || new Set(options.map(x => x.v));
      if (cb.checked) set.add(o.v); else set.delete(o.v);
      state[key] = (set.size === options.length) ? null : set;
      refreshBtn(); render();
    };
    item.appendChild(cb); item.appendChild(el("span", null, esc(o.t)));
    item.onclick = e => { if (e.target !== cb) { cb.checked = !cb.checked; cb.onchange(); } };
    menu.appendChild(item);
  });
  btn.onclick = e => { e.stopPropagation(); closeAll(dd); dd.classList.toggle("open"); };
  refreshBtn();
  dd.appendChild(btn); dd.appendChild(menu); wrap.appendChild(dd);
  return wrap;
}
function rebuildChecks(menu, key, options) {
  const set = state[key];
  [...menu.querySelectorAll(".dd-item input")].forEach((cb, i) => { cb.checked = !set || set.has(options[i].v); });
}
function closeAll(except) { document.querySelectorAll(".dd.open").forEach(d => { if (d !== except) d.classList.remove("open"); }); }
document.addEventListener("click", () => closeAll(null));

/* ============================================================
   TABS
   ============================================================ */
const TAB_TITLES = { overview: "Overview", brands: "Brand Performance",
  markets: "Market Leadership", articles: "Article Insights", trends: "Trends" };
document.getElementById("tabs").addEventListener("click", e => {
  const t = e.target.closest(".tab"); if (!t) return;
  state.tab = t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
  render();
});

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const onTrends = state.tab === "trends";
  document.getElementById("period-label").textContent =
    (onTrends ? "All quarters" : PER[state.period]) + "  ·  " + genartLabel();
  document.getElementById("tab-title").textContent = TAB_TITLES[state.tab];
  // The Trends page always spans every quarter, so the period slicer is hidden there.
  const ps = document.getElementById("slicer-period");
  if (ps) ps.style.display = onTrends ? "none" : "";
  const note = document.getElementById("ctx-note");
  note.innerHTML = "Metric: basket positions (QTY_POS) — times a part was placed in the TopMotive catalog basket with intent to buy. &nbsp;★ = ZF Group brand. &nbsp;“Eigenmarken” (private-label aggregate) is counted in all totals, market &amp; region demand, but excluded from brand / article rankings.";
  const page = document.getElementById("page");
  page.innerHTML = "";
  ({ overview: renderOverview, brands: renderBrands, markets: renderMarkets,
     articles: renderArticles, trends: renderTrends }[state.tab])(page);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(adjustBarLabels);
}

// After layout, keep each bar's value label inside its bar when it fits,
// otherwise move it just to the right of the bar end (never floating far away).
function adjustBarLabels() {
  document.querySelectorAll(".hbar-track").forEach(track => {
    const val = track.querySelector(".hbar-val"); if (!val) return;
    const w = parseFloat(val.dataset.w) || 0;
    const trackPx = track.clientWidth || 0;
    const fillPx = trackPx * w / 100;
    if (val.scrollWidth + 14 > fillPx) {           // does not fit inside the bar
      val.classList.remove("inside"); val.classList.add("outside");
      val.style.right = "auto";
      val.style.left = Math.min(fillPx + 6, trackPx + 6) + "px";
    } else {
      val.classList.remove("outside"); val.classList.add("inside");
      val.style.left = "auto";
      val.style.right = `calc(${100 - w}% + 8px)`;
    }
  });
}

/* ---------------- OVERVIEW ---------------- */
function renderOverview(page) {
  const rows = brandRows();
  const st = brandStats(rows);

  // KPI row (filter-driven cards + portfolio-mover cards side by side)
  const kpi = el("div", "grid"); kpi.style.gridTemplateColumns = "repeat(auto-fit,minmax(180px,1fr))";
  kpi.appendChild(kpiCard("accent-blue", "Our Brands — Basket Demand", fmtFull(st.ours), pctS(st.ours, st.total) + " of total positions"));
  kpi.appendChild(kpiCard("accent-teal", "Competition — Basket Demand", fmtFull(st.comp), pctS(st.comp, st.total) + " of total positions"));
  kpi.appendChild(kpiCard("accent-navy", "Total Basket Demand", fmtFull(st.total),
    `${st.ranked.length} brands · ${activeMarketCount()} markets`));
  // Portfolio movers: whole time window, all markets/genarts — NOT affected by the slicers
  const pm = portfolioMovers();
  if (pm.length) {
    const gain = pm[0], drop = pm[pm.length - 1];
    kpi.appendChild(kpiCard("accent-gold", "Top ZF Gainer · product line", GEN[gain.gi].label,
      `${gain.d >= 0 ? "▲ +" : "▼ "}${gain.d.toFixed(1)} pp ZF share since ${PER[gain.firstP]} · ignores filters`));
    kpi.appendChild(kpiCard("accent-teal", "Weakest ZF · product line", GEN[drop.gi].label,
      `${drop.d >= 0 ? "▲ +" : "▼ "}${drop.d.toFixed(1)} pp ZF share since ${PER[drop.firstP]} · ignores filters`));
  }
  page.appendChild(kpi);
  if (pm.length) {
    const cap = el("p", "sub");
    cap.style.cssText = "margin:6px 2px 0;color:var(--muted)";
    cap.textContent = "The two right-hand “product line” cards show ZF share movement across all markets & quarters and are not affected by the filters.";
    page.appendChild(cap);
  }

  // main grid
  const grid = el("div", "grid");
  grid.style.gridTemplateColumns = "1.15fr 1fr 1fr";
  grid.style.gridAutoFlow = "row dense";
  grid.style.marginTop = "16px";

  const hasGeo = periodHasGeo(state.period);

  // Col1 (rowspan 2): demand share by market cluster
  const pShare = panel("Our Brands vs Competition — by Market Cluster", "Share of basket positions per cluster (100%)");
  pShare.style.gridRow = "span 2";
  if (!hasGeo) {
    pShare.appendChild(noGeoNote());
  } else {
    const byMarketOurs = new Map(), byMarketTot = new Map();
    for (const r of rows) {
      byMarketTot.set(r[COL.M], (byMarketTot.get(r[COL.M]) || 0) + r[COL.Q]);
      if (OURS[r[COL.B]]) byMarketOurs.set(r[COL.M], (byMarketOurs.get(r[COL.M]) || 0) + r[COL.Q]);
    }
    const shareRows = [...byMarketTot.entries()]
      .map(([m, tot]) => { const o = byMarketOurs.get(m) || 0; return { m, ours: o, comp: tot - o, tot }; })
      .sort((a, z) => z.tot - a.tot)
      .map(r => ({ label: MKT[r.m].label, ours: r.ours, comp: r.comp, tipHtml: clusterTip(r.m, r.ours, r.comp, r.tot) }));
    pShare.appendChild(legend([{ label: "Our Brands", cls: "blue" }, { label: "Competition", cls: "teal" }]));
    stack100(pShare, shareRows);
  }
  grid.appendChild(pShare);

  // Col2 row1: donut
  const pDonut = panel("Share of Basket Demand", "Our Brands vs Competition");
  donut(pDonut, [
    { label: "Our Brands", value: st.ours, color: COLORS.ours },
    { label: "Competition", value: st.comp, color: COLORS.comp },
  ], pctS(st.ours, st.total, 1), "Our share");
  grid.appendChild(pDonut);

  // Col3 row1: demand volume by cluster (largest markets)
  const pReg = panel("Largest Market Clusters", "Total positions · our share inside bar");
  if (!hasGeo) {
    pReg.appendChild(noGeoNote());
  } else {
    const cAgg = new Map();
    for (const r of rows) {
      let a = cAgg.get(r[COL.M]); if (!a) { a = { ours: 0, comp: 0 }; cAgg.set(r[COL.M], a); }
      if (OURS[r[COL.B]]) a.ours += r[COL.Q]; else a.comp += r[COL.Q];
    }
    const cats = [...cAgg.entries()].map(([m, v]) => ({ label: MKT[m].label, ...v }))
      .sort((a, z) => (z.ours + z.comp) - (a.ours + a.comp)).slice(0, 8);
    stackedColumns(pReg, cats);
  }
  grid.appendChild(pReg);

  // Col2 row2: top brands
  const pBrand = panel("Top Brands", "By basket positions · ZF Group highlighted · excl. Eigenmarken");
  hbars(pBrand, st.ranked.slice(0, 10).map(d => ({
    label: d.name, value: d.q, ours: d.ours,
    tipHtml: `<b>${esc(d.name)}</b>${d.ours ? " ★" : ""}<br>${fmtFull(d.q)} positions · ${pctS(d.q, st.total)}<br>Rank #${d.rank}`
  })));
  grid.appendChild(pBrand);

  // Col3 row2: top articles (if available)
  const pArt = panel("Top Articles", articleAvailable() ? "By basket positions" : "");
  if (articleAvailable()) {
    hbars(pArt, topArticles(articleRows(), 10).map(d => ({
      label: NART[d.n] + " · " + BRD[d.b].name, value: d.q, ours: OURS[d.b],
      tipHtml: `<b>${esc(NART[d.n])}</b><br>${esc(BRD[d.b].name)}${OURS[d.b] ? " ★" : ""}<br>${fmtFull(d.q)} positions`
    })));
  } else {
    pArt.appendChild(el("div", "empty", "No article-level detail for this generic article. Article data is available for: "
      + D.articleGenarts.map(c => GEN[GEN.findIndex(g => g.code === c)].label).join(", ") + "."));
  }
  grid.appendChild(pArt);

  page.appendChild(grid);
}

/* ---------------- BRAND PERFORMANCE ---------------- */
function renderBrands(page) {
  const rows = brandRows();
  const st = brandStats(rows);
  const leaderShare = st.leader ? pct(st.leader.q, st.total) : 0;
  const ourShare = pct(st.ours, st.total);
  // top competitor = highest-share brand that is NOT one of ours (and not the
  // Eigenmarken aggregate). The lead/gap is measured against THIS, so when one
  // of our own brands is the category leader we still show a real lead over #2.
  const topComp = st.ranked.find(d => !d.ours) || null;
  const topCompShare = topComp ? pct(topComp.q, st.total) : 0;
  const diff = ourShare - topCompShare;          // >0 => we lead, <0 => behind

  const kpi = el("div", "grid"); kpi.style.gridTemplateColumns = "repeat(4,1fr)";
  kpi.appendChild(kpiCard("accent-blue", "Our Brands Share", pctS(st.ours, st.total),
    fmtFull(st.ours) + " positions"));
  kpi.appendChild(kpiCard("accent-navy", "Our Brands Rank", "#" + st.ourGroupRank,
    "as a group vs individual competitors"));
  kpi.appendChild(kpiCard(diff >= 0 ? "accent-gold" : "accent-teal",
    diff >= 0 ? "Lead over #2" : "Gap to Leader",
    Math.abs(diff).toFixed(1) + " pts",
    topComp ? (diff >= 0 ? "vs " + topComp.name : "behind " + topComp.name) : ""));
  kpi.appendChild(kpiCard("accent-gold", "Category Leader", st.leader ? st.leader.name : "—",
    st.leader ? pctS(st.leader.q, st.total) + " share" + (st.leader.ours ? " ★" : "") : ""));
  page.appendChild(kpi);

  const grid = el("div", "grid"); grid.style.gridTemplateColumns = "1.3fr 1fr"; grid.style.marginTop = "16px";

  // Brand ranking
  const pRank = panel("Brand Ranking", "Top 20 brands by basket positions · ZF Group highlighted · excl. Eigenmarken");
  pRank.appendChild(legend([{ label: "Our Brands (ZF Group)", cls: "blue" }, { label: "Competition", cls: "teal" }]));
  hbars(pRank, st.ranked.slice(0, 20).map(d => ({
    label: d.name, value: d.q, ours: d.ours,
    tipHtml: `<b>${esc(d.name)}</b>${d.ours ? " ★" : ""}<br>${fmtFull(d.q)} · ${pctS(d.q, st.total)}<br>Rank #${d.rank}`
  })));
  grid.appendChild(pRank);

  // Our brands detail table
  const pDet = panel("Our Brands — Detail", "How each ZF Group brand ranks and the gap to the category leader");
  const ourRows = st.ranked.filter(d => d.ours);
  const tbl = el("table", "tm");
  tbl.innerHTML = `<thead><tr><th>Brand</th><th class="num">Positions</th><th class="num">Share</th>
    <th class="num">Rank</th><th class="num">Gap to #1</th></tr></thead>`;
  const tb = el("tbody");
  if (!ourRows.length) tb.innerHTML = `<tr><td colspan="5" class="empty">No ZF Group brands in this selection.</td></tr>`;
  for (const d of ourRows) {
    const g = (leaderShare - pct(d.q, st.total));
    tb.appendChild(el("tr", null,
      `<td><span class="pill ours">${esc(d.name)}</span></td>
       <td class="num">${fmtFull(d.q)}</td>
       <td class="num">${pctS(d.q, st.total)}</td>
       <td class="num">#${d.rank}</td>
       <td class="num">${d.rank === 1 ? "—" : g.toFixed(1) + " pts"}</td>`));
  }
  tbl.appendChild(tb); pDet.appendChild(tbl);
  // group summary line
  pDet.appendChild(el("p", "sub",
    `Combined ZF Group: ${fmtFull(st.ours)} positions · ${pctS(st.ours, st.total)} share · group rank #${st.ourGroupRank}` +
    (!topComp ? "" : diff >= 0
      ? ` · 🏆 leading by ${diff.toFixed(1)} pts over ${esc(topComp.name)}`
      : ` · ${(-diff).toFixed(1)} pts behind ${esc(topComp.name)}`)));
  grid.appendChild(pDet);
  page.appendChild(grid);

  if (PER.length > 1) {
    const pt = el("p", "sub");
    pt.style.marginTop = "16px";
    pt.innerHTML = "📈 Quarter-over-quarter evolution (brand-share trends, momentum, share by product line) now lives on the <b>Trends</b> tab.";
    page.appendChild(pt);
  }
}

/* ---------------- MARKET LEADERSHIP ---------------- */
function marketLeadership() {
  // per market stats, respecting genart/period/brand filters but covering ALL markets
  const rows = D.brandFacts.filter(r => r[COL.P] === state.period && genartMatch(r[COL.G])
    && (!state.brands || state.brands.has(r[COL.B]))
    && (!state.markets || state.markets.has(r[COL.M])));
  const byMarket = new Map(); // m -> Map(brand->qty)
  for (const r of rows) {
    if (r[COL.M] === NOGEO_M) continue;            // skip the "all markets" sentinel
    if (!byMarket.has(r[COL.M])) byMarket.set(r[COL.M], new Map());
    const mm = byMarket.get(r[COL.M]);
    mm.set(r[COL.B], (mm.get(r[COL.B]) || 0) + r[COL.Q]);
  }
  const out = [];
  byMarket.forEach((mm, m) => {
    let total = 0, ours = 0;
    // total includes every brand (incl. Eigenmarken aggregate); leader & rank
    // are computed over named brands only.
    const ranked = [];
    mm.forEach((q, b) => {
      total += q;
      if (OURS[b]) ours += q;
      if (!AGG[b]) ranked.push({ b, q, ours: OURS[b] });
    });
    ranked.sort((a, z) => z.q - a.q);
    const leader = ranked[0] || { b: -1, q: 0, ours: false };
    const compBetter = ranked.filter(d => !d.ours && d.q > ours).length;
    out.push({
      m, label: MKT[m].label, countries: MKT[m].countries || [], total, ours,
      share: pct(ours, total), rank: compBetter + 1,
      leader, leading: ours > 0 && compBetter === 0,
    });
  });
  return out;
}
function renderMarkets(page) {
  const ml = marketLeadership();
  if (!ml.length) {
    const p = panel("Market Leadership — no country split for " + PER[state.period], "");
    p.appendChild(noGeoNote());
    page.appendChild(p);
    return;
  }
  const leadingCount = ml.filter(d => d.leading).length;
  const sorted = ml.slice().sort((a, z) => z.share - a.share);
  const totalOurs = ml.reduce((s, d) => s + d.ours, 0);
  const totalAll = ml.reduce((s, d) => s + d.total, 0);

  const kpi = el("div", "grid"); kpi.style.gridTemplateColumns = "repeat(4,1fr)";
  kpi.appendChild(kpiCard("accent-gold", "Markets We Lead", leadingCount + " / " + ml.length, "ZF Group is the #1 group"));
  kpi.appendChild(kpiCard("accent-blue", "Overall Our Share", pctS(totalOurs, totalAll), "across selected markets"));
  kpi.appendChild(kpiCard("accent-navy", "Strongest Market", sorted.length ? sorted[0].label : "—",
    sorted.length ? pctS(sorted[0].ours, sorted[0].total) + " share" : ""));
  kpi.appendChild(kpiCard("accent-teal", "Weakest Market", sorted.length ? sorted[sorted.length - 1].label : "—",
    sorted.length ? pctS(sorted[sorted.length - 1].ours, sorted[sorted.length - 1].total) + " share" : ""));
  page.appendChild(kpi);

  const grid = el("div", "grid"); grid.style.gridTemplateColumns = "1fr 1.25fr"; grid.style.marginTop = "16px";

  // Our share by market (bars, gold if leading)
  const pBar = panel("Our Brands Share by Market", "Gold = ZF Group is the leading group in that market");
  hbars(pBar, sorted.map(d => ({
    label: d.label, value: d.share, ours: d.leading,
    color: d.leading ? COLORS.gold : COLORS.ours,
    tipHtml: `<b>${esc(d.label)}</b><br>Our share: ${pctS(d.ours, d.total)}<br>Our positions: ${fmtFull(d.ours)} / ${fmtFull(d.total)}<br>Group rank: #${d.rank}${d.leading ? " · 🏆 leading" : ""}`
  })), { max: 100, valFmt: it => it.value.toFixed(1) + "%" });
  grid.appendChild(pBar);

  // Detailed table
  const pTab = panel("Market Detail", "Where we lead and where we are behind · cluster = countries it covers");
  const tbl = el("table", "tm");
  tbl.innerHTML = `<thead><tr><th>Market cluster</th><th>Countries</th><th class="num">Total</th>
    <th class="num">Our pos.</th><th class="num">Our share</th><th class="num">Group rank</th>
    <th>Leader</th><th>Status</th></tr></thead>`;
  const tb = el("tbody");
  for (const d of sorted) {
    const leaderName = d.leader.b >= 0 ? BRD[d.leader.b].name : "—";
    const status = d.leading
      ? `<span class="pill lead">Leading</span>`
      : `<span class="pill behind">#${d.rank} · ${(pct(d.leader.q, d.total) - d.share).toFixed(1)} pts behind</span>`;
    const countries = d.countries.length ? d.countries.join(", ") : "—";
    tb.appendChild(el("tr", null,
      `<td>${esc(d.label)}</td><td style="color:var(--muted);max-width:260px">${esc(countries)}</td>
       <td class="num">${fmtFull(d.total)}</td><td class="num">${fmtFull(d.ours)}</td>
       <td class="num">${d.share.toFixed(1)}%</td><td class="num">#${d.rank}</td>
       <td>${esc(leaderName)}${d.leader.ours ? " ★" : ""}</td>
       <td>${status}</td>`));
  }
  tbl.appendChild(tb); pTab.appendChild(tbl);
  grid.appendChild(pTab);
  page.appendChild(grid);

  // Cluster definitions reference (from the country/cluster master file)
  const defs = MKT.filter(m => !m.noGeo && m.countries && m.countries.length);
  if (defs.length) {
    const pDef = panel("Market Cluster Definitions", "Country → cluster mapping from the ZF länder-cluster master file");
    const dl = el("div"); dl.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px 22px";
    defs.sort((a, z) => a.label.localeCompare(z.label)).forEach(m => {
      dl.appendChild(el("div", null,
        `<b style="color:var(--navy)">${esc(m.label)}</b><span style="color:var(--muted)"> — ${esc(m.countries.join(", "))}</span>`));
    });
    pDef.appendChild(dl); pDef.style.marginTop = "16px";
    page.appendChild(pDef);
  }
}

/* ---------------- ARTICLE INSIGHTS ---------------- */
function renderArticles(page) {
  if (!articleAvailable()) {
    const p = panel("Article-level detail not available", "");
    p.appendChild(el("div", "empty",
      `The selected generic article (${esc(genartLabel())}) has no article-level export. ` +
      `Switch the GENART slicer to: ${D.articleGenarts.map(c => GEN[GEN.findIndex(g => g.code === c)].label).join(", ")}.`));
    page.appendChild(p);
    return;
  }
  const rows = articleRows();
  if (!rows.length) {
    const p = panel("Article Insights", "");
    p.appendChild(el("div", "empty",
      `No article-level data for ${esc(genartLabel())} in ${esc(PER[state.period])}` +
      (state.markets ? " for the selected market(s)." : ".") +
      " Try another reporting period or generic article."));
    page.appendChild(p);
    return;
  }

  // default focus market = largest in selection
  const mktTot = sumBy(rows, AC.M, AC.Q);
  if (state.focusMarket == null || !mktTot.has(state.focusMarket)) {
    let best = null, bv = -1; mktTot.forEach((v, m) => { if (v > bv) { bv = v; best = m; } });
    state.focusMarket = best;
  }

  // KPIs. Total positions come from the (full) brand-level data so they always
  // reconcile, even in the lite build where only top articles are embedded.
  const named = topArticles(rows);             // already excludes aggregate brands
  const totalPos = brandRows().reduce((s, r) => s + r[COL.Q], 0);
  const topArt = named[0];
  // distinct-article count: precomputed (accurate) when present, else counted
  let distinctCount = named.length;
  if (D.articleDistinct) {
    if (state.genart === ALL_GEN) {
      distinctCount = 0;
      for (let g = 0; g < GEN.length; g++) distinctCount += (D.articleDistinct[g] || {})[state.period] || 0;
    } else {
      const v = (D.articleDistinct[state.genart] || {})[state.period];
      if (v != null) distinctCount = v;
    }
  }

  const kpi = el("div", "grid cols-3");
  kpi.appendChild(kpiCard("accent-navy", "Distinct Articles", fmtFull(distinctCount),
    genartLabel() + " · " + activeMarketCount() + " markets"));
  kpi.appendChild(kpiCard("accent-blue", "Total Basket Demand", fmtFull(totalPos),
    "incl. Eigenmarken aggregate"));
  if (topArt)
    kpi.appendChild(kpiCard("accent-teal", "Top Article", NART[topArt.n],
      BRD[topArt.b].name + " · " + fmtFull(topArt.q) + " positions"));
  else kpi.appendChild(kpiCard("accent-teal", "Top Article", "—", ""));
  page.appendChild(kpi);

  if (D.meta && D.meta.lite) {
    const n = el("p", "sub");
    n.style.cssText = "margin:10px 2px 0;color:var(--navy-soft)";
    n.textContent = "Lite build: only the most-demanded articles per generic article are embedded (KPI counts are exact; the full article-level detail is available in the complete build).";
    page.appendChild(n);
  }

  const grid = el("div", "grid"); grid.style.gridTemplateColumns = "1fr 1fr"; grid.style.marginTop = "16px";

  // Top articles
  const pTop = panel("Top Articles", "Most demanded part numbers · ZF Group highlighted · excl. Eigenmarken");
  hbars(pTop, named.slice(0, 15).map(d => ({
    label: NART[d.n] + " · " + BRD[d.b].name, value: d.q, ours: OURS[d.b],
    tipHtml: `<b>${esc(NART[d.n])}</b><br>${esc(BRD[d.b].name)}${OURS[d.b] ? " ★" : ""}<br>${fmtFull(d.q)} positions`
  })));
  grid.appendChild(pTop);

  // Coverage opportunity finder (requires a country/cluster split)
  const pGap = panel("Cross-Market Opportunity Finder", "");
  if (!periodHasGeo(state.period)) {
    pGap.appendChild(noGeoNote());
    grid.appendChild(pGap);
    page.appendChild(grid);
    return;
  }
  pGap.appendChild(el("p", "sub",
    "Articles that sell well across other markets but are missing or weak in the focus market — prime candidates for range extension / promotion."));
  // focus market selector (local)
  const ctl = el("div"); ctl.style.margin = "0 0 12px";
  ctl.appendChild(el("label", null, "Focus market"));
  Object.assign(ctl.querySelector("label").style, { display: "block", fontSize: "12.5px", fontWeight: 700, color: "var(--blue)", marginBottom: "5px" });
  const sel = el("select"); Object.assign(sel.style, { width: "100%", maxWidth: "300px", padding: "8px 10px", border: "1px solid var(--line-strong)", borderRadius: "4px", fontFamily: "var(--font)", fontSize: "14px" });
  [...mktTot.keys()].sort((a, z) => mktTot.get(z) - mktTot.get(a)).forEach(m => {
    const o = el("option", null, MKT[m].label + " (" + fmt(mktTot.get(m)) + ")"); o.value = m;
    if (m === state.focusMarket) o.selected = true; sel.appendChild(o);
  });
  sel.onchange = () => { state.focusMarket = +sel.value; render(); };
  ctl.appendChild(sel); pGap.appendChild(ctl);

  // compute per article: positions in focus market, positions & #markets elsewhere
  // (aggregate brands such as Eigenmarken are excluded from this analysis)
  const focus = state.focusMarket;
  const acc = new Map(); // key -> {n, b, focus, other, markets:Set}
  for (const r of rows) {
    if (AGG[r[AC.B]]) continue;
    const k = r[AC.N] * 100000 + r[AC.B];
    let a = acc.get(k);
    if (!a) { a = { n: r[AC.N], b: r[AC.B], focus: 0, other: 0, markets: new Set() }; acc.set(k, a); }
    if (r[AC.M] === focus) a.focus += r[AC.Q];
    else { a.other += r[AC.Q]; a.markets.add(r[AC.M]); }
  }
  const opp = [...acc.values()]
    .filter(d => d.markets.size >= 2)                         // present in several other markets
    .map(d => {                                              // category + opportunity score
      const avgOther = d.other / d.markets.size;
      d.cat = d.focus === 0 ? 0 : (d.focus < avgOther * 0.4 ? 1 : 2);  // 0 Missing, 1 Under, 2 Present
      d.score = d.focus === 0 ? d.other : Math.max(0, avgOther - d.focus) * d.markets.size;
      return d;
    })
    .sort((a, z) => a.cat - z.cat || z.score - a.score)      // Missing, then Under-performing, then Present; biggest first
    .slice(0, 15);

  const tbl = el("table", "tm");
  tbl.innerHTML = `<thead><tr><th>Article</th><th>Brand</th><th class="num">In other mkts</th>
    <th class="num"># mkts</th><th class="num">In ${esc(MKT[focus].label)}</th><th>Signal</th></tr></thead>`;
  const tb = el("tbody");
  if (!opp.length) tb.innerHTML = `<tr><td colspan="6" class="empty">No multi-market articles in this selection.</td></tr>`;
  for (const d of opp) {
    const signal = d.cat === 0
      ? `<span class="pill behind">Missing here</span>`
      : (d.cat === 1
        ? `<span class="pill behind">Under-performing</span>`
        : `<span class="pill ours">Present</span>`);
    tb.appendChild(el("tr", null,
      `<td>${esc(NART[d.n])}</td><td>${esc(BRD[d.b].name)}${OURS[d.b] ? " ★" : ""}</td>
       <td class="num">${fmtFull(d.other)}</td><td class="num">${d.markets.size}</td>
       <td class="num">${fmtFull(d.focus)}</td><td>${signal}</td>`));
  }
  tbl.appendChild(tb); pGap.appendChild(tbl);
  grid.appendChild(pGap);

  page.appendChild(grid);
}

/* ---------------- TRENDS ---------------- */
const TREND_PALETTE = ["#1f6fd0", "#e8a33d", "#19b3a6", "#d65b4a", "#0a55b4",
  "#2faa6e", "#8c64b3", "#b9760f", "#0f9488", "#6b7c93", "#c0584a", "#3f86e0"];

// Per-period aggregation for the current GENART + Market selection.
// Returns { totals[], ours[], comp[], byBrand:Map(b->qty[]), withData[] }.
function trendAgg() {
  const totals = PER.map(() => 0), ours = PER.map(() => 0), comp = PER.map(() => 0);
  const byBrand = new Map();
  for (const r of D.brandFacts) {
    if (!genartMatch(r[COL.G])) continue;
    if (state.markets && !state.markets.has(r[COL.M])) continue;
    const pi = r[COL.P], q = r[COL.Q];
    totals[pi] += q;
    if (OURS[r[COL.B]]) ours[pi] += q; else comp[pi] += q;
    if (!AGG[r[COL.B]]) {
      let a = byBrand.get(r[COL.B]); if (!a) { a = PER.map(() => 0); byBrand.set(r[COL.B], a); }
      a[pi] += q;
    }
  }
  const withData = PER.map((_p, i) => i).filter(i => totals[i] > 0);
  return { totals, ours, comp, byBrand, withData };
}

function renderTrends(page) {
  if (PER.length < 2) {
    const p = panel("Trends", "");
    p.appendChild(el("div", "empty", "The trend views unlock once at least two quarters are loaded."));
    page.appendChild(p);
    return;
  }
  const A = trendAgg();
  const wd = A.withData;
  const last = wd[wd.length - 1], prev = wd.length > 1 ? wd[wd.length - 2] : null;
  const shareAt = i => pct(A.ours[i], A.totals[i]);

  // brands ranked by total over the window, for the top-10 views
  const rankedBrands = [...A.byBrand.entries()]
    .map(([b, arr]) => ({ b, arr, tot: arr.reduce((s, x) => s + x, 0) }))
    .sort((a, z) => z.tot - a.tot);
  const top10 = rankedBrands.slice(0, 10);
  const since = "since " + PER[wd[0]];
  const wShare = (arr, i) => pct(arr[i], A.totals[i]);   // share at period i

  // ---- KPI row: most-improved / biggest-declining brand among the top 10 ----
  const kpi = el("div", "grid"); kpi.style.gridTemplateColumns = "repeat(2,minmax(240px,1fr))";
  const brandMovers = top10.map(o => ({ b: o.b, d: wShare(o.arr, last) - wShare(o.arr, wd[0]) }))
    .sort((a, z) => z.d - a.d);
  const upB = brandMovers[0], downB = brandMovers[brandMovers.length - 1];
  kpi.appendChild(kpiCard("accent-blue", "Most-Improved Brand · top 10",
    upB ? BRD[upB.b].name + (OURS[upB.b] ? " ★" : "") : "—",
    upB ? `${upB.d >= 0 ? "▲ +" : "▼ "}${upB.d.toFixed(1)} pp share ${since}` : ""));
  kpi.appendChild(kpiCard("accent-navy", "Biggest Decliner · top 10",
    downB ? BRD[downB.b].name + (OURS[downB.b] ? " ★" : "") : "—",
    downB ? `${downB.d >= 0 ? "▲ +" : "▼ "}${downB.d.toFixed(1)} pp share ${since}` : ""));
  page.appendChild(kpi);

  const grid = el("div", "grid cols-2"); grid.style.marginTop = "16px";

  // ---- A. ZF Group vs top competitor (share %) ----
  const pA = panel("ZF Group vs Top Competitor — Share %", "Combined ZF Group share against the leading competitor brand");
  {
    // identify the top competitor brand across the whole window
    let topComp = null, topTot = -1;
    A.byBrand.forEach((arr, b) => { if (OURS[b]) return; const t = arr.reduce((s, x) => s + x, 0); if (t > topTot) { topTot = t; topComp = b; } });
    const ourPts = wd.map(i => ({ x: i, y: shareAt(i) }));
    const compArr = topComp != null ? A.byBrand.get(topComp) : null;
    const compPts = compArr ? wd.map(i => ({ x: i, y: pct(compArr[i], A.totals[i]) })) : [];
    const series = [{ name: "ZF Group ★", color: COLORS.ours, width: 3.5, ours: true, points: ourPts }];
    if (topComp != null) series.push({ name: BRD[topComp].name, color: COLORS.gold, width: 2.5, points: compPts });
    pA.appendChild(legend(series.map(s => ({ label: s.name, color: s.color }))));
    lineChart(pA, PER.slice(), series, { yFmt: v => v.toFixed(1) + "%", endLabels: "all" });
  }
  grid.appendChild(pA);

  // ---- C. ZF vs Competition volume (absolute, stacked columns per quarter) ----
  const pC = panel("Basket Demand over Time — ZF vs Competition", "Total positions per quarter · ZF share inside bar");
  stackedColumns(pC, wd.map(i => ({ label: PER[i], ours: A.ours[i], comp: A.comp[i] })));
  grid.appendChild(pC);
  page.appendChild(grid);

  // ---- B. Top 5 brands + ZF brands (share %) — full width ----
  const pB = panel("Brand Share % — Top 5 + ZF Group", "One line per brand · ZF Group bolder and marked ★");
  pB.style.marginTop = "16px";
  {
    const ranked = [...A.byBrand.entries()].map(([b, arr]) => ({ b, tot: arr.reduce((s, x) => s + x, 0) }))
      .sort((a, z) => z.tot - a.tot);
    const keep = new Set(ranked.slice(0, 5).map(d => d.b));
    A.byBrand.forEach((_a, b) => { if (OURS[b]) keep.add(b); });
    const brands = ranked.filter(d => keep.has(d.b)).map(d => d.b);
    const series = brands.map((b, i) => ({
      name: BRD[b].name + (OURS[b] ? " ★" : ""), color: TREND_PALETTE[i % TREND_PALETTE.length],
      width: OURS[b] ? 3.5 : 2, ours: OURS[b],
      points: wd.map(pi => ({ x: pi, y: pct(A.byBrand.get(b)[pi], A.totals[pi]) })),
    }));
    pB.appendChild(legend(series.map(s => ({ label: s.name, color: s.color }))));
    lineChart(pB, PER.slice(), series, { yFmt: v => v.toFixed(1) + "%", endLabels: "ours" });
  }
  page.appendChild(pB);

  const grid2 = el("div", "grid cols-2"); grid2.style.marginTop = "16px";

  // ---- D. ZF Group share by generic article (all genarts, ignores GENART filter) ----
  const pD = panel("ZF Group Share by Product Line", "Our combined share per generic article over time (all genarts)");
  {
    const series = GEN.map((g, gi) => {
      const tot = PER.map(() => 0), ourq = PER.map(() => 0);
      for (const r of D.brandFacts) {
        if (r[COL.G] !== gi) continue;
        if (state.markets && !state.markets.has(r[COL.M])) continue;
        tot[r[COL.P]] += r[COL.Q]; if (OURS[r[COL.B]]) ourq[r[COL.P]] += r[COL.Q];
      }
      const points = PER.map((p, pi) => pi).filter(pi => tot[pi] > 0).map(pi => ({ x: pi, y: pct(ourq[pi], tot[pi]) }));
      return { name: g.label, color: TREND_PALETTE[gi % TREND_PALETTE.length], width: 2.5, points };
    }).filter(s => s.points.length);
    pD.appendChild(legend(series.map(s => ({ label: s.name, color: s.color }))));
    lineChart(pD, PER.slice(), series, { yFmt: v => v.toFixed(1) + "%", endLabels: "all" });
  }
  grid2.appendChild(pD);

  // ---- E. Momentum: top-10 brand share change vs previous quarter (pp) ----
  const pE = panel("Momentum — Brand Share Change", prev != null
    ? "Top 10 brands · change in share (pp) " + PER[prev] + " → " + PER[last] + " · ★ = ZF Group" : "");
  if (prev == null) {
    pE.appendChild(el("div", "empty", "Needs two quarters with data in the current selection."));
  } else {
    const items = top10.map(o => ({
      b: o.b, d: pct(o.arr[last], A.totals[last]) - pct(o.arr[prev], A.totals[prev]),
    })).sort((a, z) => z.d - a.d);
    const dById = new Map(items.map(it => [it.b, it.d]));
    if (!items.length) pE.appendChild(el("div", "empty", "No brands in this selection."));
    else hbars(pE, items.map(it => ({
      b: it.b, label: BRD[it.b].name + (OURS[it.b] ? " ★" : ""), value: Math.max(0.001, Math.abs(it.d)),
      ours: OURS[it.b], color: it.d >= 0 ? "#2faa6e" : "#d65b4a",
      tipHtml: `<b>${esc(BRD[it.b].name)}</b>${OURS[it.b] ? " ★" : ""}<br>${PER[prev]}: ${pct(A.byBrand.get(it.b)[prev], A.totals[prev]).toFixed(2)}%<br>${PER[last]}: ${pct(A.byBrand.get(it.b)[last], A.totals[last]).toFixed(2)}%<br>Change: ${it.d >= 0 ? "+" : ""}${it.d.toFixed(2)} pp`,
    })), { valFmt: it => { const d = dById.get(it.b); return (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(2) + " pp"; } });
  }
  grid2.appendChild(pE);
  page.appendChild(grid2);

  page.appendChild(el("p", "sub",
    "Shares respect the GENART and Market slicers (the by-product-line chart always spans all generic articles). 2025 quarters have no country split, so a Market filter limits trends to quarters that do."));
}

/* ---------------- helpers ---------------- */
function deltaCard(accent, label, value, delta, unit, footText) {
  const c = el("div", "kpi " + accent);
  c.appendChild(el("div", "kpi-label", esc(label)));
  c.appendChild(el("div", "kpi-value", esc(value)));
  if (delta == null) { c.appendChild(el("div", "kpi-foot", "—")); return c; }
  const up = delta >= 0;
  const f = el("div", "kpi-foot");
  f.innerHTML = `<span style="color:${up ? "var(--good)" : "var(--bad)"};font-weight:700">`
    + `${up ? "▲" : "▼"} ${(up ? "+" : "") + delta.toFixed(1)}${unit}</span> ${esc(footText || "vs prev. quarter")}`;
  c.appendChild(f);
  return c;
}
function noGeoNote() {
  return el("div", "empty", "Quarter " + PER[state.period] + " was delivered without a country / cluster split, "
    + "so market-level views are not available for it. Brand totals and the time trend still include this quarter.");
}
function clusterTip(m, ours, comp, tot) {
  const c = MKT[m].countries || [];
  return `<b>${esc(MKT[m].label)}</b>${c.length ? `<br><span style="color:var(--muted)">${esc(c.join(", "))}</span>` : ""}`
    + `<br>Our brands: ${fmtFull(ours)} (${pctS(ours, tot)})<br>Competition: ${fmtFull(comp)}<br>Total: ${fmtFull(tot)}`;
}
function kpiCard(accent, label, value, foot) {
  const c = el("div", "kpi " + accent);
  c.appendChild(el("div", "kpi-label", esc(label)));
  c.appendChild(el("div", "kpi-value", esc(value)));
  if (foot) c.appendChild(el("div", "kpi-foot", esc(foot)));
  return c;
}
function activeMarketCount() {
  if (state.markets) return [...state.markets].filter(m => m !== NOGEO_M).length;
  return MKT.filter(m => !m.noGeo).length;
}
function articleAvailable() {
  return state.genart === ALL_GEN || D.articleGenarts.includes(GEN[state.genart].code);
}

/* ---- resize re-render (charts use container width) ------- */
let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(render, 180); });

/* ---- go -------------------------------------------------- */
buildSlicers();
render();
})();

