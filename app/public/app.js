import {
  digestHtml,
  escapeHtml,
  reproduceHtml,
  formatRuleHtml,
  highlightJson,
  jsonProofButton,
  proofSummary,
  renderProofBody,
  renderProofFold,
  renderTableWorkup,
} from "./proof.mjs";

const $ = (id) => document.getElementById(id);
const leaflet = window.L;

const state = {
  summary: null,
  methods: [],
  candidates: {
    dem: "Democratic",
    demShort: "Dem",
    rep: "Republican",
    repShort: "Rep",
    other: "Other",
    year: 2020,
    office: "President",
  },
  page: 0,
  limit: 80,
  selected: null,
  layer: null,
  findings: null,
  methodId: null,
  labType: "",
  fileType: "unsorted_series",
  patternType: "feed_retraction",
  timeSeries: null,
  timeChartTitle: "",
  timeChartMark: null,
  timeChartHead: null,
  mapRenderer: null,
  coverageSort: "name",
  labSort: "votes",
  labPayload: null,
  benfordSort: "mad",
  chartTableSort: "time",
  countySort: "delta",
  proofPackets: {},
  jsonProof: { text: "", filename: "" },
  countyOverlay: true,
  countyWinners: null,
  countyShapes: null,
  countyLayer: null,
};

const map = leaflet.map("map", { scrollWheelZoom: true }).setView([39.8, -98.6], 4);
map.createPane("countyWinners");
map.getPane("countyWinners").style.zIndex = 350;
map.createPane("precincts");
map.getPane("precincts").style.zIndex = 450;
leaflet.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
  maxZoom: 12,
  subdomains: "abcd",
}).addTo(map);

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function methodName(id) {
  return state.methods.find((m) => m.id === id)?.name || id;
}

function methodColor(id) {
  return state.methods.find((m) => m.id === id)?.color || "#8b97b0";
}

function showBanner(text, err) {
  const el = $("banner");
  if (!text) {
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.toggle("err", Boolean(err));
  el.classList.remove("hidden");
}

function noteDismissed() {
  try {
    return sessionStorage.getItem("et-unmapped-note") === "1";
  } catch {
    return false;
  }
}

function dismissUnmappedNote() {
  try {
    sessionStorage.setItem("et-unmapped-note", "1");
  } catch {
    /* ignore quota / private mode */
  }
  fillUnmappedNote(0, 0);
}

function fillUnmappedNote(unmapped, total) {
  const el = $("unmapped-note");
  if (!el) return;
  if (!unmapped || noteDismissed()) {
    el.classList.add("hidden");
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const pct = total ? Math.round((unmapped / total) * 100) : 0;
  const of = total ? `of ${fmt(total)}` : "";
  const share = total ? `~${pct}%` : "";
  el.hidden = false;
  el.classList.remove("hidden");
  el.innerHTML = `
    <span class="map-note-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M8 8.8a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z"/>
        <path d="M8 14.2s5-3.4 5-7.1A5 5 0 0 0 3 7.1c0 3.7 5 7.1 5 7.1z"/>
        <path d="M3.2 12.8 12.8 3.2"/>
      </svg>
    </span>
    <div class="map-note-stat">
      <strong>${fmt(unmapped)}</strong>
      <span>${of}${share ? ` · ${share}` : ""}</span>
    </div>
    <div class="map-note-copy">
      <p class="map-note-title">No usable map point</p>
      <p>Still scanned and can still be flagged. They have no pin on the map.</p>
    </div>
    <button type="button" class="map-note-dismiss" data-dismiss-unmapped aria-label="Dismiss map-point note">
      <svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
    </button>`;
  el.querySelector("[data-dismiss-unmapped]")?.addEventListener("click", dismissUnmappedNote);
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { body });
  return body;
}

const GROUP_LABEL = {
  completeness: "Missing or empty",
  integrity: "The numbers cannot be right",
  partisan: "Almost nobody voted the other way",
  spatial: "Too big or too dense for this state",
  pattern: "The same odd thing repeats",
  temporal: "How the count moved",
};

function syncLegend() {
  const selected = state.labType || "";
  document.querySelectorAll("#lab-method-switch [data-type]").forEach((btn) => {
    const on = (btn.dataset.type || "") === selected;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function methodHitCount(id) {
  return Number(state.summary?.byType?.[id]) || 0;
}

function labMethods() {
  return (state.methods || []).filter((m) => methodHitCount(m.id) > 0);
}

function fillFilters() {
  const st = $("state");
  st.innerHTML = `<option value="all">All precinct states</option>`;
  const cov = state.summary.coverage || {};
  const precinctByFips = Object.fromEntries((state.summary.states || []).map((s) => [s.fips, s]));
  const roster = [...(cov.roster || (state.summary.states || []).map((s) => ({ ...s, precinct: true, nyt: true })))].sort(
    (a, b) => String(a.name || "").localeCompare(String(b.name || "")),
  );
  for (const j of roster) {
    const opt = document.createElement("option");
    opt.value = j.fips;
    const p = precinctByFips[j.fips];
    opt.textContent = p
      ? `${j.name}  ·  ${p.flagged} flagged / ${p.precincts}`
      : `${j.name}  ·  night file only`;
    st.appendChild(opt);
  }
  fillLabMethodBoard();
  fillMethodBoard();
}

function explainCards(plain) {
  const rows = [
    { title: "What this is", body: plain?.about || "" },
    { title: "Why it is flagged", body: plain?.whyFlagged || plain?.note || "" },
    { title: "Why that is unusual", body: plain?.whyAnomaly || "" },
  ].filter((r) => String(r.body || "").trim());
  if (!rows.length) return "";
  return `<div class="explain-cards">${rows
    .map(
      (r) =>
        `<article class="explain-card">
          <h5>${escapeHtml(r.title)}</h5>
          <p>${escapeHtml(r.body)}</p>
        </article>`,
    )
    .join("")}</div>`;
}

function fillLabExplain() {
  const host = $("lab-method-explain");
  if (!host) return;
  const id = state.labType || "";
  if (!id) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  const m = (state.methods || []).find((x) => x.id === id);
  if (!m) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.innerHTML = `<article class="method-card" id="lab-explain-${escapeHtml(m.id)}">
    <header class="method-card-head">
      <h3><span class="dot" style="background:${m.color}"></span>${escapeHtml(m.name)}</h3>
      <p class="method-card-meta">${fmt(methodHitCount(m.id))} flagged · ${escapeHtml(GROUP_LABEL[m.group] || m.group || "")}</p>
    </header>
    ${explainCards(m.plain)}
  </article>`;
}

function fillLabMethodBoard() {
  const el = $("lab-method-switch");
  if (!el) return;
  const flagged = state.summary?.flagged || 0;
  const ranked = labMethods().sort(
    (a, b) => methodHitCount(b.id) - methodHitCount(a.id) || String(a.name).localeCompare(String(b.name)),
  );
  const rows = [
    { id: "", name: "All methods", n: flagged },
    ...ranked.map((m) => ({ id: m.id, name: m.name, n: methodHitCount(m.id) })),
  ];
  renderCountPills(el, rows, state.labType || "");
  el.querySelectorAll("[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.labType = btn.dataset.type || "";
      state.page = 0;
      syncLegend();
      fillLabExplain();
      refresh();
    });
  });
  fillLabExplain();
}

function fillMethodBoard() {
  const el = $("method-switch");
  const pane = $("method-pane");
  if (!el || !pane) return;
  const ranked = [...(state.methods || [])].sort(
    (a, b) => methodHitCount(b.id) - methodHitCount(a.id) || String(a.name).localeCompare(String(b.name)),
  );
  if (!ranked.length) return;
  if (!state.methodId || !ranked.some((m) => m.id === state.methodId)) {
    state.methodId = ranked[0].id;
  }
  el.innerHTML = ranked
    .map((m) => {
      const n = methodHitCount(m.id);
      const active = m.id === state.methodId;
      return `<button type="button" data-method-pick="${escapeHtml(m.id)}" class="lab-method-pill${active ? " active" : ""}" aria-selected="${active ? "true" : "false"}">
        <span class="lab-method-pill-name">${escapeHtml(m.name)}</span>
        <span class="lab-method-pill-count">${fmt(n)}</span>
      </button>`;
    })
    .join("");
  el.querySelectorAll("[data-method-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.methodId = btn.dataset.methodPick;
      fillMethodBoard();
      const card = $("method-card-" + state.methodId);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  });
  pane.innerHTML = ranked
    .map((m) => {
      const n = methodHitCount(m.id);
      const group = GROUP_LABEL[m.group] || m.group || "";
      const extra =
        m.group === "temporal"
          ? `<p class="method-card-note">How the count moved — same comparisons as Night-of count.</p>`
          : "";
      const on = m.id === state.methodId;
      return `<article class="method-card${on ? " active" : ""}" id="method-card-${escapeHtml(m.id)}">
        <header class="method-card-head">
          <h3><span class="dot" style="background:${m.color}"></span>${escapeHtml(m.name)}</h3>
          <p class="method-card-meta">${fmt(n)} flagged · ${escapeHtml(group)}</p>
        </header>
        ${explainCards(m.plain)}
        ${extra}
        ${seenInBlock(m)}
        ${formatRuleHtml(m.rule || "")}
      </article>`;
    })
    .join("");
}

function showMethodPane(id) {
  state.methodId = id;
  fillMethodBoard();
}

function fmtWhen(iso) {
  if (!iso) return "—";
  return String(iso).replace("T", " ").replace("Z", " UTC").slice(0, 22);
}

function coverageOf() {
  return state.summary?.coverage || {};
}

function isFileOnly(fips) {
  return (coverageOf().missingPrecinct || []).some((j) => j.fips === fips);
}

function jurisdictionName(fips) {
  const j = (coverageOf().roster || []).find((x) => x.fips === fips);
  return j?.name || fips;
}

function typeCount(f, id) {
  if (id === "unsorted_series") return f.counts?.errorByKind?.unsorted_series ?? 0;
  if (id === "county_vs_state") return f.counts?.errorByKind?.county_vs_state ?? 0;
  if (id === "implied_negative_candidate") return f.counts?.errorByKind?.implied_negative_candidate ?? 0;
  if (id === "feed_vote_switch") return f.counts?.errorByKind?.feed_vote_switch ?? 0;
  if (id === "eevp_backwards") return f.counts?.errorByKind?.eevp_backwards ?? 0;
  if (id === "feed_retraction") return f.counts?.retractions ?? 0;
  if (id === "lead_flip") return f.counts?.flips ?? 0;
  if (id === "onesided_dump") return f.counts?.dumps ?? 0;
  if (id === "county_clean_math") return f.counts?.countyMismatch ?? 0;
  return 0;
}

function paneHead(t) {
  const method = t.sameMethod ? state.methods.find((m) => m.id === t.sameMethod) : null;
  const methodLine = method
    ? `<p class="same-method">Same comparison as precinct method <a href="#methods" data-method="${escapeHtml(method.id)}">${escapeHtml(method.name)}</a>. Thresholds differ by scale. Re-run either rule on its inputs.</p>`
    : "";
  return `<div class="file-pane-head">
    <h3>${escapeHtml(t.name)}</h3>
    ${explainCards({
      about: t.about,
      whyFlagged: t.whyFlagged || t.note,
      whyAnomaly: t.whyAnomaly,
    })}
    ${methodLine}
  </div>`;
}

function seenInBlock(m) {
  if (!m.sameAs?.length) return "";
  const f = state.findings;
  const items = m.sameAs
    .map((link) => {
      const t = [...(f?.errorTypes || []), ...(f?.types || [])].find((x) => x.id === link.id);
      const n = f ? typeCount(f, link.id) : null;
      const tab = link.tab === "files" ? "In the files" : "Night-of count";
      const href = link.tab === "files" ? "#files" : "#patterns";
      const count = n == null ? "" : ` · ${n}`;
      return `<li><a href="${href}" data-finding="${escapeHtml(link.id)}" data-tab="${escapeHtml(link.tab)}">${escapeHtml(tab)}</a> · ${escapeHtml(t?.name || link.id)}${count}</li>`;
    })
    .join("");
  return `<div class="seen-in"><p>Same comparison in the night files</p><ul>${items}</ul></div>`;
}

function dataPanel(opts) {
  const columns = opts.columns || [];
  const sort = opts.sort || [];
  const pills = sort
    .map(
      (s) =>
        `<button type="button" class="data-sort-btn${s.active ? " active" : ""}" data-sort="${escapeHtml(s.id)}">${escapeHtml(s.label)}</button>`,
    )
    .join("");
  const heads = columns
    .map((c) => `<th class="${c.cls || ""}">${escapeHtml(c.label)}</th>`)
    .join("");
  const empty = opts.empty || "None";
  const body =
    opts.rowsHtml ||
    `<tr class="empty-row"><td colspan="${Math.max(1, columns.length)}">${escapeHtml(empty)}</td></tr>`;
  return `<section class="data-panel${opts.cls ? " " + opts.cls : ""}">
    <header class="data-panel-head">
      <div>
        <h3>${escapeHtml(opts.title || "")}</h3>
        ${opts.subtitle ? `<p>${escapeHtml(opts.subtitle)}</p>` : ""}
      </div>
      ${pills ? `<div class="data-sort">${pills}</div>` : ""}
    </header>
    <div class="data-table-wrap">
      <table class="data-table${opts.clickable ? " clickable" : ""}${opts.tableCls ? " " + opts.tableCls : ""}">
        <thead><tr>${heads}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

function bindPanelSort(root, onSort) {
  if (!root) return;
  root.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => onSort(btn.dataset.sort));
  });
}

function sortLabel(id, labels) {
  return labels[id] || id;
}

function fillCoverage() {
  const cov = coverageOf();
  const c = cov.counts || {};
  const missing = cov.missingPrecinct || [];
  const missingNames = missing.map((j) => j.postal || j.name).join(", ") || "None";
  const board = $("coverage-board");
  if (board) {
    board.className = "stat-grid";
    board.innerHTML = `
      <article class="stat-card">
        <h4>Precinct extract</h4>
        <p class="stat-sub">46 states + DC on the map</p>
        <div class="stat-metrics">
          <div><b class="accent">${fmt(c.precinct)}</b><span>jurisdictions</span></div>
          <div><b>${fmt(state.summary.precincts)}</b><span>precincts</span></div>
        </div>
        <p class="stat-extra">${fmt(state.summary.flagged)} flagged on this extract</p>
      </article>
      <article class="stat-card">
        <h4>Night files</h4>
        <p class="stat-sub">50 states + DC in the live feed</p>
        <div class="stat-metrics">
          <div><b class="accent">${fmt(c.nyt)}</b><span>files</span></div>
          <div><b>${fmt(c.missingNyt)}</b><span>missing files</span></div>
        </div>
        <p class="stat-extra">Same year as the precinct extract</p>
      </article>
      <article class="stat-card">
        <h4>No precinct geometry</h4>
        <p class="stat-sub">${escapeHtml(missingNames)}</p>
        <div class="stat-metrics">
          <div><b class="accent">${fmt(c.missingPrecinct)}</b><span>states</span></div>
          <div><b>${fmt((c.nyt || 0) - (c.missingPrecinct || 0))}</b><span>on the map</span></div>
        </div>
        <p class="stat-extra">Night file still opens in the lab</p>
      </article>`;
  }
  fillCoverageRoster();
  const box = $("coverage-workup");
  if (box) {
    box.innerHTML = renderTableWorkup(
      cov.workup
        ? { ...cov.workup, items: [{ label: "coverage", type: "coverage", state: "50 states + DC", rule: "expected − precinct extract", checks: cov.workup.checks, sha256: cov.workup.sha256, inputs: cov.workup.counts }] }
        : null,
      "coverage",
    );
    if (cov.workup) registerWorkups({ coverage: cov.workup });
  }
}

function coverageRosterRows() {
  const cov = coverageOf();
  const byFips = Object.fromEntries((state.summary.states || []).map((s) => [s.fips, s]));
  return (cov.roster || []).map((j) => {
    const p = byFips[j.fips] || {};
    return {
      ...j,
      precincts: Number(p.precincts) || 0,
      flagged: Number(p.flagged) || 0,
    };
  });
}

function fillCoverageRoster() {
  const el = $("coverage-roster");
  if (!el) return;
  const sort = state.coverageSort || "name";
  const labels = { name: "name", postal: "postal", precincts: "precincts", flagged: "flagged" };
  const rows = coverageRosterRows().sort((a, b) => {
    if (sort === "postal") return String(a.postal || "").localeCompare(String(b.postal || ""));
    if (sort === "precincts") return (b.precincts || 0) - (a.precincts || 0) || String(a.name).localeCompare(String(b.name));
    if (sort === "flagged") return (b.flagged || 0) - (a.flagged || 0) || String(a.name).localeCompare(String(b.name));
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  const body = rows
    .map(
      (j) => `<tr data-fips="${escapeHtml(j.fips)}">
        <td class="cell-title">${escapeHtml(j.name)}${j.precinct ? "" : `<div class="cell-muted">Night file only</div>`}</td>
        <td class="cell-muted">${escapeHtml(j.postal || j.fips)}</td>
        <td class="${j.precinct ? "num-secondary" : "num-empty"}">${j.precinct ? fmt(j.precincts) : "—"}</td>
        <td class="${j.precinct ? "num-primary" : "num-empty"}">${j.precinct ? fmt(j.flagged) : "—"}</td>
      </tr>`,
    )
    .join("");
  el.innerHTML = dataPanel({
    title: "Jurisdictions",
    subtitle: `Sorted by ${sortLabel(sort, labels)}. Showing ${rows.length} of 51. Click a row to open the lab.`,
    clickable: true,
    sort: [
      { id: "name", label: "Name", active: sort === "name" },
      { id: "postal", label: "Postal", active: sort === "postal" },
      { id: "precincts", label: "Precincts", active: sort === "precincts" },
      { id: "flagged", label: "Flagged", active: sort === "flagged" },
    ],
    columns: [
      { label: "Jurisdiction" },
      { label: "Postal" },
      { label: "Precincts", cls: "num" },
      { label: "Flagged", cls: "num" },
    ],
    rowsHtml: body,
    empty: "No jurisdictions listed.",
  });
  bindPanelSort(el, (id) => {
    state.coverageSort = id;
    fillCoverageRoster();
  });
  el.querySelectorAll("tbody tr[data-fips]").forEach((tr) => {
    tr.addEventListener("click", () => openJurisdiction(tr.dataset.fips));
  });
}

function signedDelta(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
}

function fmtStat(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && v.includes("%")) return v;
  if (typeof v === "string" && /[A-Za-z]/.test(v) && !/^[+\-−]?\d/.test(v.trim())) return v;
  const raw = typeof v === "number" ? v : Number(String(v).replace(/[+ ,]/g, "").replace("−", "-"));
  if (!Number.isFinite(raw)) return String(v);
  const sign = raw > 0 ? "+" : raw < 0 ? "−" : "";
  const a = Math.abs(raw);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`;
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(a >= 100_000 ? 1 : 2)}K`;
  return `${sign}${a.toLocaleString()}`;
}

function findingSummary(id) {
  const types = [...(state.findings?.errorTypes || []), ...(state.findings?.types || [])];
  const t = types.find((x) => x.id === id);
  return t?.whyAnomaly || t?.whyFlagged || t?.about || "";
}

function renderCardWorkup(w, key) {
  return renderProofFold(w, key, {
    variant: "card",
    summary: proofSummary(w) || findingSummary(w?.type),
  });
}

function nightCardWorkups(items) {
  const out = {};
  (items || []).forEach((r, i) => {
    if (r?.workup) out[`night-${i}`] = r.workup;
  });
  return out;
}

function nightHead(t, n) {
  const line = String(t.about || t.whyFlagged || t.note || "").trim();
  const method = t.sameMethod ? state.methods.find((m) => m.id === t.sameMethod) : null;
  const methodLine = method
    ? `<p class="night-method-link">Same rule as <a href="#methods" data-method="${escapeHtml(method.id)}">${escapeHtml(method.name)}</a></p>`
    : "";
  return `<header class="night-method">
    <div>
      <h3>${escapeHtml(t.name)}</h3>
      ${line ? `<p>${escapeHtml(line)}</p>` : ""}
      ${methodLine}
    </div>
    <p class="night-method-count"><strong>${fmt(n)}</strong><span>${n === 1 ? "state" : "states"}</span></p>
  </header>`;
}

function nightCardHead(row, opts = {}) {
  const facts = opts.facts
    ? opts.facts(row)
    : [
        { label: "Biden", value: row.demGain, accent: true },
        { label: "Trump", value: row.repGain },
      ];
  const type = opts.type || row.workup?.type || row.kind || "";
  return {
    state: row.state || "—",
    kind: opts.kind || "",
    sub: opts.sub ? opts.sub(row) : "",
    meta: opts.meta ? opts.meta(row) : "",
    facts: facts.slice(0, 2),
    why: proofSummary(row.workup) || findingSummary(type) || "",
  };
}

function nightFactsHtml(head) {
  if (!head) return "";
  const metrics = (head.facts || [])
    .map(
      (fact, fi) => `<div>
        <b class="${fact.accent || fi === 0 ? "accent" : ""}">${escapeHtml(fmtStat(fact.value))}</b>
        <span>${escapeHtml(fact.label)}</span>
      </div>`,
    )
    .join("");
  return `${head.kind ? `<p class="night-popup-kind">${escapeHtml(head.kind)}</p>` : ""}
    ${head.sub || head.meta
      ? `<p class="night-popup-line">
        ${head.sub ? `<span>${escapeHtml(head.sub)}</span>` : ""}
        ${head.meta ? `<span class="night-card-meta">${escapeHtml(head.meta)}</span>` : ""}
      </p>`
      : ""}
    ${metrics ? `<div class="night-card-metrics">${metrics}</div>` : ""}
    ${head.why ? `<p class="night-popup-why">${escapeHtml(head.why)}</p>` : ""}`;
}

function nightPreviewCards(items, opts) {
  if (!items.length) return `<p class="night-empty">None on this extract.</p>`;
  return `<div class="night-grid">${items
    .map((r, i) => {
      const head = nightCardHead(r, opts);
      const chart =
        r.series && r.series.length >= 2
          ? renderTimeChart(r.series, { bare: true, preview: true, hideOther: true, thin: true, markT: r.timestamp })
          : `<p class="muted">No series window.</p>`;
      return `<article class="night-card">
        <header class="night-card-head">
          <div>
            <h4>${escapeHtml(head.state)}</h4>
            ${head.sub ? `<p>${escapeHtml(head.sub)}</p>` : ""}
          </div>
          ${head.meta ? `<span class="night-card-meta">${escapeHtml(head.meta)}</span>` : ""}
        </header>
        ${head.facts.length
          ? `<div class="night-card-metrics">${head.facts
              .map(
                (fact, fi) => `<div>
            <b class="${fact.accent || fi === 0 ? "accent" : ""}">${escapeHtml(fmtStat(fact.value))}</b>
            <span>${escapeHtml(fact.label)}</span>
          </div>`,
              )
              .join("")}</div>`
          : ""}
        <div class="night-card-chart" data-night-chart="${i}">${chart}</div>
        ${renderCardWorkup(r.workup, `night-${i}`)}
      </article>`;
    })
    .join("")}</div>`;
}

function nightView(f, t) {
  const id = t.id;
  if (id === "feed_retraction") {
    return {
      items: f.retractions || [],
      sub: (r) => `${fmt(r.from)} → ${fmt(r.to)}`,
      meta: (r) => (r.eevp != null ? `${r.eevp}% in` : ""),
    };
  }
  if (id === "implied_negative_candidate") {
    return {
      items: (f.errors || []).filter((e) => e.kind === "implied_negative_candidate"),
      sub: (r) => `${r.who} ${fmt(r.worst)}`,
      meta: (r) => `${r.n} update${r.n === 1 ? "" : "s"}`,
    };
  }
  if (id === "feed_vote_switch") {
    return {
      items: (f.errors || []).filter((e) => e.kind === "feed_vote_switch"),
      sub: (r) => `${r.who} ${fmt(r.worst)}`,
      meta: (r) => (r.eevp != null ? `${r.eevp}% in` : ""),
    };
  }
  if (id === "eevp_backwards") {
    return {
      items: (f.errors || []).filter((e) => e.kind === "eevp_backwards"),
      sub: (r) => `${r.from}% → ${r.to}%`,
      meta: (r) => (r.delta != null ? signedDelta(r.delta) : ""),
      facts: (r) => [
        { label: "From", value: `${r.from}%` },
        { label: "To", value: `${r.to}%` },
      ],
    };
  }
  if (id === "lead_flip") {
    const who = (pp) => (pp > 0 ? "Biden" : "Trump");
    return {
      items: f.flips || [],
      sub: (r) =>
        `${who(r.leadFrom)} ${Math.abs(r.leadFrom)}pp → ${who(r.leadTo)} ${Math.abs(r.leadTo)}pp`,
      meta: (r) => (r.eevp != null ? `${r.eevp}% in` : ""),
    };
  }
  if (id === "onesided_dump") {
    return {
      items: f.dumps || [],
      sub: (r) => `${r.who} ${r.share}% of +${fmt(r.delta)}`,
      meta: (r) => (r.eevp != null ? `${r.eevp}% in` : ""),
    };
  }
  return { items: nightItems(f, id), sub: () => "" };
}

function nightItems(f, id) {
  if (id === "lead_flip") return f.flips || [];
  if (id === "feed_retraction") return f.retractions || [];
  if (id === "onesided_dump") return f.dumps || [];
  if (id === "implied_negative_candidate" || id === "eevp_backwards" || id === "feed_vote_switch") {
    return (f.errors || []).filter((e) => e.kind === id);
  }
  return [];
}

function burstBar(label, cls, value, maxAbs) {
  const pct = Math.max(0.8, (Math.abs(value) / maxAbs) * 50);
  const signed = `${value > 0 ? "+" : ""}${fmt(value)}`;
  const left = value < 0 ? `<i class="${cls}" style="width:${pct}%"></i>` : "";
  const right = value >= 0 ? `<i class="${cls}" style="width:${pct}%"></i>` : "";
  return `<div class="burst-row">
    <span class="burst-name">${escapeHtml(label)}</span>
    <div class="burst-track" role="img" aria-label="${escapeHtml(label)} ${signed}">
      <span class="burst-neg">${left}</span>
      <span class="burst-mid"></span>
      <span class="burst-pos">${right}</span>
    </div>
    <span class="burst-n ${value < 0 ? "down" : "up"}">${signed}</span>
  </div>`;
}

function fileTable(f, id) {
  if (id === "unsorted_series") {
    const n = f.counts?.errorByKind?.unsorted_series || 0;
    const total = f.counts?.states ?? "?";
    return dataPanel({
      title: "Timeline order",
      subtitle: `${n} of ${total} files share the same first-point dump-order pattern.`,
      columns: [
        { label: "Where" },
        { label: "What the file contains" },
      ],
      rowsHtml: `<tr>
        <td class="cell-title">${n} of ${total} files</td>
        <td class="cell-muted">First timeseries point is a later timestamp with zero votes, then the clock jumps backward to the start of reporting.</td>
      </tr>`,
    });
  }
  if (id === "county_vs_state") {
    const sort = state.countySort || "delta";
    const items = (f.errors || []).filter((e) => e.kind === "county_vs_state");
    items.sort((a, b) => {
      if (sort === "state") return String(a.state || "").localeCompare(String(b.state || ""));
      return Math.abs(Number(b.delta) || 0) - Math.abs(Number(a.delta) || 0);
    });
    const rows = items
      .map(
        (e) => `<tr>
          <td class="cell-title">${escapeHtml(e.state)}</td>
          <td class="num-secondary">${fmt(e.countySum)}</td>
          <td class="num-secondary">${fmt(e.stateVotes)}</td>
          <td class="num-primary">${fmt(e.delta)}</td>
        </tr>`,
      )
      .join("");
    return dataPanel({
      title: "County vs state totals",
      subtitle: items.length
        ? `Sorted by ${sort === "state" ? "state" : "difference"}. Showing ${items.length} of ${items.length}.`
        : "County sum matches the state total in every file.",
      sort: [
        { id: "state", label: "State", active: sort === "state" },
        { id: "delta", label: "Difference", active: sort === "delta" },
      ],
      columns: [
        { label: "State" },
        { label: "County sum", cls: "num" },
        { label: "State total", cls: "num" },
        { label: "Difference", cls: "num" },
      ],
      rowsHtml: rows,
      empty: "None",
    });
  }
  if (id === "feed_retraction") {
    return nightPreviewCards(f.retractions || [], {
      blurb: "Each card is a drop in the running total. Click the preview for the detailed line graph.",
      title: (r) => `${r.state} · running total went down`,
      sub: (r) => `${fmt(r.from)} → ${fmt(r.to)} · ${r.eevp ?? "—"}% expected`,
    });
  }
  if (id === "implied_negative_candidate") {
    return nightPreviewCards(
      (f.errors || []).filter((e) => e.kind === "implied_negative_candidate"),
      {
        blurb: "Each card is a state where share × total implies a candidate lost 5,000+ while the total did not fall. Click the preview to enlarge.",
        title: (r) => `${r.state} · implied ${r.who} loss`,
        sub: (r) => `${r.who} ${fmt(r.worst)} · ${r.n} update${r.n === 1 ? "" : "s"} · ${r.eevp ?? "—"}% expected`,
      },
    );
  }
  if (id === "feed_vote_switch") {
    return nightPreviewCards(
      (f.errors || []).filter((e) => e.kind === "feed_vote_switch"),
      {
        blurb: "Implied counts swapped with a flat total.",
        title: (r) => `${r.state} · implied swap`,
        sub: (r) => `${r.who} ${fmt(r.worst)}`,
      },
    );
  }
  if (id === "eevp_backwards") {
    return nightPreviewCards(
      (f.errors || []).filter((e) => e.kind === "eevp_backwards"),
      {
        blurb: "Each card is an expected-in drop of more than 5 points. Click the preview to enlarge.",
        title: (r) => `${r.state} · expected-in went down`,
        sub: (r) => `${r.from}% → ${r.to}% expected`,
        facts: (r) => [
          { label: "From", value: `${r.from}%` },
          { label: "To", value: `${r.to}%` },
          { label: "Total Δ", value: signedDelta(r.delta) },
        ],
      },
    );
  }
  if (id === "lead_flip") {
    const who = (pp) => (pp > 0 ? "Biden" : "Trump");
    return nightPreviewCards(f.flips || [], {
      blurb: "Each card is one lead change. The small chart is a preview — click it for the detailed line graph.",
      title: (r) => `${r.state} · lead change`,
      sub: (r) =>
        `${who(r.leadFrom)} ${Math.abs(r.leadFrom)}pp → ${who(r.leadTo)} ${Math.abs(r.leadTo)}pp · ${r.eevp ?? "—"}% expected`,
    });
  }
  if (id === "onesided_dump") {
    return nightPreviewCards(f.dumps || [], {
      blurb: "Each card is a 150,000+ update that went mostly to one candidate. Click the preview to enlarge.",
      title: (r) => `${r.state} · ${r.who} batch`,
      sub: (r) => `${r.who} ${r.share}% of +${fmt(r.delta)} · ${r.eevp ?? "—"}% expected`,
    });
  }
  if (id === "county_clean_math") {
    return `<p class="muted">County candidate columns add up in every county in these files. Column mismatches: ${fmt(f.counts?.countyMismatch ?? 0)}.</p>`;
  }
  return "";
}

function renderCountPills(el, items, activeId) {
  if (!el) return;
  el.innerHTML = (items || [])
    .map((m) => {
      const active = String(activeId || "") === String(m.id || "");
      return `<button type="button" role="tab" data-type="${escapeHtml(m.id)}" class="lab-method-pill${active ? " active" : ""}" aria-selected="${active ? "true" : "false"}">
        <span class="lab-method-pill-name">${escapeHtml(m.name)}</span>
        <span class="lab-method-pill-count">${fmt(m.n)}</span>
      </button>`;
    })
    .join("");
}

function renderTypeSwitch(el, types, f, activeId) {
  if (!el) return;
  const ranked = [...types]
    .sort((a, b) => typeCount(f, b.id) - typeCount(f, a.id))
    .map((t) => ({ id: t.id, name: t.name, n: typeCount(f, t.id) }));
  renderCountPills(el, ranked, activeId);
}

function allFindingTypes(f) {
  const seen = new Set();
  const out = [];
  for (const t of [...(f?.errorTypes || []), ...(f?.types || [])]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function typesOnTab(f, tab) {
  return allFindingTypes(f).filter((t) => (t.tab || "files") === tab);
}

function showFilePane(id) {
  const f = state.findings;
  if (!f) return;
  const types = typesOnTab(f, "files");
  const t = types.find((x) => x.id === id) || types[0];
  if (!t) return;
  state.fileType = t.id;
  const pane = $("file-pane");
  if (!pane) return;
  renderTypeSwitch($("file-switch"), types, f, t.id);
  $("file-switch")?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => showFilePane(btn.dataset.type));
  });
  const packet = f.workups?.byKind?.[t.id] || null;
  pane.innerHTML = `${paneHead(t)}${fileTable(f, t.id)}${renderTableWorkup(packet, t.id)}`;
  registerWorkups({ [t.id]: packet });
  bindPanelSort(pane, (sid) => {
    if (t.id === "county_vs_state") {
      state.countySort = sid;
      showFilePane(t.id);
    }
  });
}

function showPatternPane(id) {
  const f = state.findings;
  if (!f) return;
  const types = typesOnTab(f, "patterns");
  const t = types.find((x) => x.id === id) || types[0];
  if (!t) return;
  state.patternType = t.id;
  const pane = $("pattern-pane");
  if (!pane) return;
  renderTypeSwitch($("pattern-switch"), types, f, t.id);
  $("pattern-switch")?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => showPatternPane(btn.dataset.type));
  });
  const view = nightView(f, t);
  pane.innerHTML = `${nightHead(t, view.items.length)}${nightPreviewCards(view.items, view)}`;
  registerWorkups(nightCardWorkups(view.items));
  bindNightCharts(pane, view, t);
}

function bindNightCharts(root, view, t) {
  const items = view.items || [];
  root.querySelectorAll("[data-night-chart]").forEach((el) => {
    const row = items[Number(el.dataset.nightChart)];
    if (!row?.series || row.series.length < 2) return;
    el.querySelector("[data-enlarge]")?.addEventListener("click", () => {
      state.timeSeries = row.series;
      state.timeChartHead = nightCardHead(row, {
        ...view,
        kind: t?.name || "",
        type: t?.id || row.kind || row.workup?.type,
      });
      state.timeChartTitle = state.timeChartHead.state;
      state.timeChartMark = row.timestamp || null;
      openTimePopup();
    });
  });
}

function fillBriefing() {
  getJson("/api/findings")
    .then((f) => {
      state.findings = f;
      showFilePane(state.fileType || "unsorted_series");
      showPatternPane(state.patternType || "feed_retraction");
      fillMethodBoard();
    })
    .catch(() => {
      const pane = $("file-pane");
      if (pane) {
        pane.innerHTML =
          "<p class='page-note'>Per-state NYT JSON was not loaded. Put the 51 state files in media/nyt-election-data/.</p>";
      }
    });
}

function fillBenford() {
  const host = $("benford-panel");
  if (!host) return;
  const names = Object.fromEntries(
    (state.summary.states || []).map((s) => [s.fips, s.name]),
  );
  const sort = state.benfordSort || "mad";
  const labels = { mad: "MAD", n: "n", grade: "grade", state: "state" };
  const entries = Object.entries(state.summary.benford || {})
    .filter(([, v]) => v && v.mad != null)
    .map(([fips, v]) => ({
      fips,
      name: names[fips] || fips,
      n: Number(v.n) || 0,
      mad: Number(v.mad),
      grade: v.grade || "",
    }));
  entries.sort((a, b) => {
    if (sort === "n") return b.n - a.n || a.name.localeCompare(b.name);
    if (sort === "grade") return String(a.grade).localeCompare(String(b.grade)) || b.mad - a.mad;
    if (sort === "state") return a.name.localeCompare(b.name);
    return b.mad - a.mad || a.name.localeCompare(b.name);
  });
  const body = entries
    .map(
      (v) => `<tr>
        <td class="cell-title">${escapeHtml(v.name)}</td>
        <td class="num-empty">${fmt(v.n)}</td>
        <td class="num-secondary">${v.mad.toFixed(4)}</td>
        <td class="num-primary">${escapeHtml(v.grade)}</td>
      </tr>`,
    )
    .join("");
  host.innerHTML = dataPanel({
    title: "State first-digit check",
    subtitle: `Sorted by ${sortLabel(sort, labels)}. Showing ${entries.length} of ${entries.length}.`,
    sort: [
      { id: "mad", label: "MAD", active: sort === "mad" },
      { id: "n", label: "n", active: sort === "n" },
      { id: "grade", label: "Grade", active: sort === "grade" },
      { id: "state", label: "State", active: sort === "state" },
    ],
    columns: [
      { label: "State" },
      { label: "n", cls: "num" },
      { label: "MAD", cls: "num" },
      { label: "Grade", cls: "num" },
    ],
    rowsHtml: body,
    empty: "No Benford rows.",
  });
  bindPanelSort(host, (id) => {
    state.benfordSort = id;
    fillBenford();
  });
}

function qs() {
  const p = new URLSearchParams();
  const st = $("state").value;
  const ty = state.labType || "";
  const q = $("q").value.trim();
  if (st && st !== "all") p.set("state", st);
  if (ty) p.set("type", ty);
  if (q) p.set("q", q);
  if ($("all")?.checked) p.set("all", "1");
  p.set("limit", String(state.limit));
  p.set("offset", String(state.page * state.limit));
  return p;
}

function labSortedRows(rows) {
  const sort = state.labSort || "votes";
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === "geoid") return String(a.geoid || "").localeCompare(String(b.geoid || ""));
    if (sort === "state") return String(a.stateName || "").localeCompare(String(b.stateName || "")) || String(a.geoid || "").localeCompare(String(b.geoid || ""));
    if (sort === "lead") return (Number(b.pct_dem_lead) || 0) - (Number(a.pct_dem_lead) || 0);
    if (sort === "density") return (Number(b.votes_per_sqkm) || 0) - (Number(a.votes_per_sqkm) || 0);
    return (Number(b.votes_total) || 0) - (Number(a.votes_total) || 0);
  });
  return copy;
}

function renderLabSort() {
  const host = $("lab-sort");
  if (!host) return;
  const sort = state.labSort || "votes";
  const pills = [
    { id: "geoid", label: "GEOID" },
    { id: "state", label: "State" },
    { id: "votes", label: "Votes" },
    { id: "lead", label: "Lead" },
    { id: "density", label: "Density" },
  ];
  host.innerHTML = pills
    .map(
      (s) =>
        `<button type="button" class="data-sort-btn${s.id === sort ? " active" : ""}" data-sort="${s.id}">${s.label}</button>`,
    )
    .join("");
  bindPanelSort(host, (id) => {
    state.labSort = id;
    if (state.labPayload) renderTable(state.labPayload);
  });
}

function renderTable(payload) {
  state.labPayload = payload;
  const tb = $("rows");
  if (!tb) return;
  tb.innerHTML = "";
  const rows = labSortedRows(payload.rows || []);
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    tr.innerHTML = `<td colspan="6">No precincts match these filters.</td>`;
    tb.appendChild(tr);
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (state.selected === row.geoid) tr.classList.add("active");
    tr.innerHTML = `
      <td class="cell-title">${escapeHtml(row.geoid)}</td>
      <td class="cell-muted">${escapeHtml(row.stateName)}</td>
      <td class="num-primary">${fmt(row.votes_total)}</td>
      <td class="num-secondary">${fmt(row.pct_dem_lead)}</td>
      <td class="num-secondary">${fmt(row.votes_per_sqkm)}</td>
      <td><div class="flags">${(row.flags || [])
        .map(
          (id) =>
            `<span class="pill" style="--pill:${methodColor(id)}">${escapeHtml(methodName(id))}</span>`,
        )
        .join("")}</div></td>`;
    tr.addEventListener("click", () => select(row.geoid, row));
    tb.appendChild(tr);
  }
  const total = payload.total || 0;
  const pages = Math.max(1, Math.ceil(total / state.limit));
  const from = total ? state.page * state.limit + 1 : 0;
  const to = Math.min(total, (state.page + 1) * state.limit);
  const sortLabels = { geoid: "GEOID", state: "state", votes: "votes", lead: "lead", density: "density" };
  if ($("lab-table-sub")) {
    $("lab-table-sub").textContent = `Sorted by ${sortLabel(state.labSort || "votes", sortLabels)}. Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}.`;
  }
  if ($("pager")) $("pager").textContent = `Page ${state.page + 1} / ${pages}`;
  if ($("prev")) $("prev").disabled = state.page <= 0;
  if ($("next")) $("next").disabled = state.page + 1 >= pages;
  renderLabSort();
}

function names() {
  return state.candidates || {};
}

function residualOf(row) {
  const d = Number(row.votes_dem);
  const r = Number(row.votes_rep);
  const t = Number(row.votes_total);
  if (![d, r, t].every(Number.isFinite)) return null;
  return t - d - r;
}

function shareParts(row) {
  const d = Math.max(0, Number(row.votes_dem) || 0);
  const r = Math.max(0, Number(row.votes_rep) || 0);
  const t = Number(row.votes_total);
  const otherRaw = residualOf(row);
  const o = otherRaw != null && otherRaw > 0 ? otherRaw : 0;
  const sum = d + r + o;
  const den = sum > 0 ? sum : t > 0 ? t : 1;
  return { d, r, o, t: Number.isFinite(t) ? t : sum, den };
}

function renderShareBar(row, opts = {}) {
  const n = names();
  const { d, r, o, den } = shareParts(row);
  const pd = (100 * d) / den;
  const pr = (100 * r) / den;
  const po = (100 * o) / den;
  const track = `<div class="share-track" role="img" aria-label="Vote share">
      <span class="seg dem" style="width:${pd}%"></span>
      <span class="seg rep" style="width:${pr}%"></span>
      <span class="seg oth" style="width:${po}%"></span>
    </div>
    <ul class="share-legend">
      <li><i class="dem"></i>${escapeHtml(n.dem || "Democratic")} · ${fmt(d)} (${pd.toFixed(1)}%)</li>
      <li><i class="rep"></i>${escapeHtml(n.rep || "Republican")} · ${fmt(r)} (${pr.toFixed(1)}%)</li>
      <li><i class="oth"></i>${escapeHtml(n.other || "Other")} · ${fmt(o)} (${po.toFixed(1)}%)</li>
    </ul>`;
  if (opts.compact) return `<div class="share-compact">${track}</div>`;
  return `<div class="viz">
    <h4>Party comparison</h4>
    <p class="muted">${escapeHtml(n.year || "")} ${escapeHtml(n.office || "")}</p>
    ${track}
  </div>`;
}

function parseStamp(t) {
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtChartTime(t, mode) {
  const d = parseStamp(t);
  if (!d) return String(t || "—");
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  if (mode === "full") return `${mon} ${day}, ${d.getUTCFullYear()} ${hh}:${mm}:${ss} UTC`;
  if (mode === "day") return `${mon} ${day}`;
  return `${mon} ${day} ${hh}:${mm}`;
}

function fmtAxis(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v));
}

function niceStep(span, target) {
  const raw = Math.max(span, 1) / Math.max(target, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const nice = n >= 7.5 ? 10 : n >= 3.5 ? 5 : n >= 1.5 ? 2 : 1;
  return nice * mag;
}

function yScale(max, target) {
  const step = niceStep(max, target);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = 0; v <= top + step / 4; v += step) ticks.push(v);
  return { ticks, top };
}

function candidateTickIndexes(pts, xAt, maxTicks) {
  if (!pts.length) return [];
  const last = pts.length - 1;
  if (last === 0) return [0];
  const timed = pts.every((p) => p.ms != null);
  const tmin = timed ? Math.min(...pts.map((p) => p.ms)) : 0;
  const tmax = timed ? Math.max(...pts.map((p) => p.ms)) : last;
  const n = Math.max(2, Math.min(maxTicks, pts.length));
  const idxs = new Set([0, last]);
  for (let k = 1; k < n - 1; k++) {
    if (timed && tmax > tmin) {
      const target = tmin + (k / (n - 1)) * (tmax - tmin);
      let best = 0;
      let bestD = Infinity;
      pts.forEach((p, i) => {
        const d = Math.abs(p.ms - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      idxs.add(best);
    } else {
      idxs.add(Math.round((k * last) / (n - 1)));
    }
  }
  return [...idxs].sort((a, b) => a - b);
}

function spaceTickIndexes(pts, xAt, indexes, minGap) {
  if (!indexes.length) return [];
  const xs = indexes.map((i) => ({ i, x: xAt(pts[i], i) }));
  const first = xs[0];
  const last = xs[xs.length - 1];
  if (xs.length === 1) return [first.i];
  if (last.x - first.x < minGap) return [first.i];
  const kept = [first];
  for (let k = 1; k < xs.length - 1; k++) {
    if (xs[k].x - kept[kept.length - 1].x >= minGap) kept.push(xs[k]);
  }
  if (last.x - kept[kept.length - 1].x >= minGap) {
    kept.push(last);
  } else if (kept.length > 1 && last.x - kept[kept.length - 2].x >= minGap) {
    kept[kept.length - 1] = last;
  } else {
    kept.push(last);
    while (kept.length > 2 && kept[kept.length - 1].x - kept[kept.length - 2].x < minGap) {
      kept.splice(kept.length - 2, 1);
    }
  }
  return kept.map((k) => k.i);
}

function pickXTickIndexes(pts, xAt, { maxTicks = 6, minGap = 120 } = {}) {
  return spaceTickIndexes(pts, xAt, candidateTickIndexes(pts, xAt, maxTicks), minGap);
}

function anomalyIndexes(pts, markT) {
  const set = new Set();
  if (!markT || !pts.length) return set;
  const markMs = parseStamp(markT)?.getTime();
  let idx = pts.findIndex((p) => p.t === markT);
  if (idx < 0 && markMs != null) {
    let best = Infinity;
    pts.forEach((p, i) => {
      if (p.ms == null) return;
      const d = Math.abs(p.ms - markMs);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
  }
  if (idx >= 0) {
    set.add(idx);
    if (idx > 0) set.add(idx - 1);
  }
  return set;
}

function flipMarkSvg(pts, markT, xAt, pad, innerH) {
  if (!markT) return "";
  const markMs = parseStamp(markT)?.getTime();
  let idx = pts.findIndex((p) => p.t === markT);
  if (idx < 0 && markMs != null) {
    let best = Infinity;
    pts.forEach((p, i) => {
      if (p.ms == null) return;
      const d = Math.abs(p.ms - markMs);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
  }
  if (idx < 0) return "";
  const x = xAt(pts[idx], idx).toFixed(1);
  return `<line class="flip-mark" x1="${x}" x2="${x}" y1="${pad.t}" y2="${pad.t + innerH}"></line>
    <text class="tick flip-mark-label" x="${x}" y="${pad.t + 10}" text-anchor="middle">flip</text>`;
}

function chartPoints(series) {
  return (series || []).map((s) => {
    const d = Number(s.votes_dem) || 0;
    const r = Number(s.votes_rep) || 0;
    const tot = Number(s.votes_total);
    const o = Number.isFinite(tot) ? Math.max(0, tot - d - r) : 0;
    const when = parseStamp(s.t);
    return {
      t: s.t || "",
      ms: when ? when.getTime() : null,
      d,
      r,
      o,
      tot: Number.isFinite(tot) ? tot : d + r + o,
      eevp: s.eevp ?? null,
    };
  });
}

function renderTimeChart(series, opts) {
  const options = typeof opts === "string" ? { mode: opts } : opts || {};
  const n = names();
  const large = options.mode === "full";
  const preview = Boolean(options.preview);
  const hideOther = Boolean(options.hideOther);
  const thin = Boolean(options.thin) || preview;
  if (!series || series.length < 2) {
    return `<div class="viz">
      <h4>Votes over time</h4>
      <p class="muted">This file is a single snapshot, so there is no reporting timeline yet. Add a <code>history</code> array or prior-report fields to chart ${escapeHtml(n.demShort || "Dem")} vs ${escapeHtml(n.repShort || "Rep")} as counts come in.</p>
    </div>`;
  }
  const pts = chartPoints(series);
  const timed = pts.every((p) => p.ms != null);
  const tmin = timed ? Math.min(...pts.map((p) => p.ms)) : 0;
  const tmax = timed ? Math.max(...pts.map((p) => p.ms)) : pts.length - 1;
  const w = large ? 1000 : preview ? 240 : 420;
  const h = large ? 440 : preview ? 68 : 210;
  const pad = large
    ? { l: 58, r: 36, t: 16, b: 92 }
    : preview
      ? { l: 8, r: 8, t: 8, b: 8 }
      : { l: 42, r: 18, t: 12, b: thin ? 58 : 36 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const rawMax = Math.max(
    1,
    ...pts.map((p) => Math.max(p.d, p.r, hideOther ? 0 : p.o, hideOther ? 0 : p.tot)),
  );
  const { ticks, top } = yScale(rawMax, large ? 7 : preview ? 2 : 4);
  const xAt = (p, i) => {
    if (timed && tmax > tmin) return pad.l + ((p.ms - tmin) / (tmax - tmin)) * innerW;
    return pad.l + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  };
  const yAt = (v) => pad.t + innerH - (v / top) * innerH;
  const line = (key) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(p, i).toFixed(1)},${yAt(p[key]).toFixed(1)}`).join(" ");
  const area = (key) => {
    const topPath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(p, i).toFixed(1)},${yAt(p[key]).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    const first = pts[0];
    return `${topPath} L${xAt(last, pts.length - 1).toFixed(1)},${yAt(0).toFixed(1)} L${xAt(first, 0).toFixed(1)},${yAt(0).toFixed(1)} Z`;
  };
  const rDot = preview ? 0 : thin ? (large ? 2.1 : 1.6) : large ? 3.6 : 2.6;
  const dots = (key, cls) =>
    preview || !rDot
      ? ""
      : pts
          .map(
            (p, i) =>
              `<circle class="${cls}" data-i="${i}" cx="${xAt(p, i).toFixed(1)}" cy="${yAt(p[key]).toFixed(1)}" r="${rDot}"></circle>`,
          )
          .join("");
  const xIdx = preview
    ? []
    : pickXTickIndexes(pts, xAt, {
        maxTicks: large ? 6 : 4,
        minGap: large ? 130 : 78,
      });
  const xLabels = preview
    ? ""
    : xIdx
        .map((i) => {
          const p = pts[i];
          const x = xAt(p, i).toFixed(1);
          const y = pad.t + innerH + 14;
          const label = fmtChartTime(p.t, "short");
          const rot = large ? ` transform="rotate(-32 ${x} ${y})"` : "";
          const anchor = large ? "end" : "middle";
          return `<text class="tick tick-x" x="${x}" y="${y}" text-anchor="${anchor}"${rot}>${escapeHtml(label)}</text>`;
        })
        .join("");
  const grid = preview
    ? ""
    : ticks
        .map((v) => {
          const y = yAt(v).toFixed(1);
          return `<line class="grid" x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}"></line>
        <text class="tick" x="${pad.l - 6}" y="${Number(y) + 3}" text-anchor="end">${escapeHtml(fmtAxis(v))}</text>`;
        })
        .join("");
  const cls = `time-chart${large ? " large" : ""}${thin ? " thin" : ""}${preview ? " preview" : ""}`;
  const areas = thin
    ? ""
    : `<path class="area dem" d="${area("d")}"></path>
      <path class="area rep" d="${area("r")}"></path>
      ${hideOther ? "" : `<path class="area oth" d="${area("o")}"></path>`}`;
  const svg = `<svg class="${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Votes over time by candidate">
      ${grid}
      <line class="axis" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + innerH}"></line>
      <line class="axis" x1="${pad.l}" y1="${pad.t + innerH}" x2="${pad.l + innerW}" y2="${pad.t + innerH}"></line>
      ${areas}
      <path class="line dem" d="${line("d")}" fill="none"></path>
      <path class="line rep" d="${line("r")}" fill="none"></path>
      ${hideOther ? "" : `<path class="line oth" d="${line("o")}" fill="none"></path>`}
      ${dots("d", "dem")}
      ${dots("r", "rep")}
      ${hideOther ? "" : dots("o", "oth")}
      ${flipMarkSvg(pts, options.markT, xAt, pad, innerH)}
      <line class="guide" data-guide x1="0" y1="${pad.t}" x2="0" y2="${pad.t + innerH}" visibility="hidden"></line>
      ${xLabels}
    </svg>`;
  if (large) return svg;
  const legend = `<ul class="share-legend">
      <li><i class="dem"></i>${escapeHtml(n.demShort || "Dem")}</li>
      <li><i class="rep"></i>${escapeHtml(n.repShort || "Rep")}</li>
      ${hideOther ? "" : `<li><i class="oth"></i>${escapeHtml(n.other || "Other")}</li>`}
    </ul>`;
  if (options.bare) {
    return `<div data-time-chart>
    <button type="button" class="time-chart-hit${preview ? " preview" : ""}" data-enlarge aria-label="Enlarge votes over time">
      ${svg}
    </button>
    ${preview ? "" : `<p class="chart-readout muted" data-readout>Hover or click a point.</p>${legend}`}
  </div>`;
  }
  return `<div class="viz" data-time-chart>
    <h4>Votes over time</h4>
    <p class="muted">Click the chart for a larger view with time ticks and counts per candidate.</p>
    <button type="button" class="time-chart-hit" data-enlarge aria-label="Enlarge votes over time">
      ${svg}
    </button>
    <p class="chart-readout muted" data-readout>Hover or click a point.</p>
    ${legend}
  </div>`;
}

function readoutHtml(p) {
  const n = names();
  const eevp = p.eevp == null ? "" : ` · ${escapeHtml(String(p.eevp))}% expected`;
  return `<strong>${escapeHtml(fmtChartTime(p.t, "full"))}</strong>${eevp}<br>
    ${escapeHtml(n.demShort || "Dem")} ${fmt(p.d)} · ${escapeHtml(n.repShort || "Rep")} ${fmt(p.r)} · Other ${fmt(p.o)} · Total ${fmt(p.tot)}`;
}

function bindTimeChartHover(root, series) {
  const svg = root.querySelector("svg.time-chart");
  const out = root.querySelector("[data-readout]");
  if (!svg || !series || series.length < 2) return;
  const pts = chartPoints(series);
  const timed = pts.every((p) => p.ms != null);
  const tmin = timed ? Math.min(...pts.map((p) => p.ms)) : 0;
  const tmax = timed ? Math.max(...pts.map((p) => p.ms)) : pts.length - 1;
  const vb = svg.viewBox.baseVal;
  const padL = Number(svg.querySelector("line.axis")?.getAttribute("x1")) || 42;
  const innerW = vb.width - padL - 10;
  const xAt = (p, i) => {
    if (timed && tmax > tmin) return padL + ((p.ms - tmin) / (tmax - tmin)) * innerW;
    return padL + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  };
  const guide = svg.querySelector("[data-guide]");
  const baseR = {};
  svg.querySelectorAll("circle[data-i]").forEach((c) => {
    if (baseR[c.dataset.i] == null) baseR[c.dataset.i] = c.getAttribute("r") || "2.1";
  });
  const flagged = [...anomalyIndexes(pts, state.timeChartMark)];
  let pinned = flagged.length ? flagged[flagged.length - 1] : pts.length - 1;
  const pick = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * vb.width;
    let best = 0;
    let bestD = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(xAt(p, i) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  const show = (i, pin) => {
    if (pin) pinned = i;
    const p = pts[i];
    if (out) out.innerHTML = readoutHtml(p);
    if (guide) {
      const x = xAt(p, i).toFixed(1);
      guide.setAttribute("x1", x);
      guide.setAttribute("x2", x);
      guide.setAttribute("visibility", "visible");
    }
    root.querySelectorAll("tr[data-i]").forEach((tr) => {
      const idx = Number(tr.dataset.i);
      tr.classList.toggle("active", idx === i);
      tr.classList.toggle("pinned", idx === pinned);
    });
    svg.querySelectorAll("circle[data-i]").forEach((c) => {
      const on = Number(c.dataset.i) === i;
      c.classList.toggle("picked", on);
      c.setAttribute("r", on ? String(Number(baseR[c.dataset.i] || 2) + 2) : baseR[c.dataset.i] || "2.1");
    });
    const row = root.querySelector(`tr[data-i="${i}"]`);
    row?.scrollIntoView({ block: "nearest" });
  };
  svg.addEventListener("mousemove", (e) => show(pick(e.clientX)));
  svg.addEventListener("click", (e) => {
    e.preventDefault();
    show(pick(e.clientX), true);
  });
  svg.addEventListener("mouseleave", () => show(pinned));
  root.querySelectorAll("tr[data-i]").forEach((tr) => {
    tr.addEventListener("click", () => show(Number(tr.dataset.i), true));
  });
  show(pinned, true);
}

function closeTimePopup() {
  const modal = $("chart-modal");
  if (!modal) return;
  modal.hidden = true;
  modal.classList.add("hidden");
}

function isJsonProofOpen() {
  const modal = $("json-modal");
  return Boolean(modal && !modal.hidden);
}

function closeJsonProof() {
  const modal = $("json-modal");
  if (!modal) return;
  modal.hidden = true;
  modal.classList.add("hidden");
}

function openJsonProof(key) {
  const packet = state.proofPackets[key];
  if (!packet) return;
  const text = JSON.stringify(packet, null, 2);
  state.jsonProof = { text, filename: `electiontrace-workup-${key}.json` };
  const modal = $("json-modal");
  const pre = $("json-modal-pre");
  const sub = $("json-modal-sub");
  if (!modal || !pre) return;
  if ($("json-modal-title")) $("json-modal-title").textContent = "Proof of work JSON";
  if (sub) {
    const bits = [packet.label, packet.type || packet.table, packet.state].filter(Boolean);
    sub.textContent = bits.length ? bits.join(" · ") : key;
  }
  const sha = $("json-modal-sha");
  if (sha) sha.innerHTML = digestHtml(packet.sha256);
  const repro = $("json-modal-repro");
  if (repro) repro.innerHTML = reproduceHtml(packet);
  pre.innerHTML = highlightJson(text);
  const copyBtn = $("json-modal-copy");
  if (copyBtn) copyBtn.textContent = "Copy";
  modal.hidden = false;
  modal.classList.remove("hidden");
  $("json-modal-close")?.focus();
}

async function copyJsonProof() {
  const text = state.jsonProof.text;
  const btn = $("json-modal-copy");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) btn.textContent = "Copied";
  } catch {
    if (btn) btn.textContent = "Copy failed";
  }
}

function downloadJsonProof() {
  const { text, filename } = state.jsonProof;
  if (!text) return;
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename || "electiontrace-workup.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function openTimePopup() {
  const series = state.timeSeries;
  if (!series || series.length < 2) return;
  const modal = $("chart-modal");
  const body = $("chart-modal-body");
  const sub = $("chart-modal-sub");
  if (!modal || !body) return;
  const head = state.timeChartHead;
  const facts = $("chart-modal-facts");
  if ($("chart-modal-title")) {
    $("chart-modal-title").textContent = head?.state || state.timeChartTitle || "Votes over time";
  }
  if (sub) {
    if (head) {
      sub.textContent = "";
      sub.hidden = true;
    } else {
      sub.hidden = false;
      sub.textContent = `${series.length} snapshots · hover or click a point to highlight that row`;
    }
  }
  if (facts) {
    if (head) {
      facts.hidden = false;
      facts.innerHTML = nightFactsHtml(head);
    } else {
      facts.hidden = true;
      facts.innerHTML = "";
    }
  }
  const n = names();
  const pts = chartPoints(series);
  body.innerHTML = `
    <div data-time-chart-full>
      <div class="time-chart-frame">
      ${renderTimeChart(series, { mode: "full", markT: state.timeChartMark, hideOther: Boolean(state.timeChartMark), thin: Boolean(state.timeChartMark) })}
      </div>
      <p class="chart-readout" data-readout></p>
      <ul class="share-legend">
        <li><i class="dem"></i>${escapeHtml(n.dem || n.demShort || "Dem")}</li>
        <li><i class="rep"></i>${escapeHtml(n.rep || n.repShort || "Rep")}</li>
        <li><i class="oth"></i>${escapeHtml(n.other || "Other")}</li>
      </ul>
      <div id="chart-point-panel"></div>
    </div>`;
  renderChartPointTable(body, pts);
  modal.hidden = false;
  modal.classList.remove("hidden");
  bindTimeChartHover(body, series);
  $("chart-modal-close")?.focus();
}

function renderChartPointTable(root, pts) {
  const host = root.querySelector("#chart-point-panel");
  if (!host) return;
  const n = names();
  const sort = state.chartTableSort || "time";
  const flagged = anomalyIndexes(pts, state.timeChartMark);
  const order = pts.map((p, i) => i);
  order.sort((ia, ib) => {
    const a = pts[ia];
    const b = pts[ib];
    if (sort === "dem") return (Number(b.d) || 0) - (Number(a.d) || 0);
    if (sort === "rep") return (Number(b.r) || 0) - (Number(a.r) || 0);
    if (sort === "total") return (Number(b.tot) || 0) - (Number(a.tot) || 0);
    return ia - ib;
  });
  const rows = order
    .map((i) => {
      const p = pts[i];
      const flag = flagged.has(i) ? " anomaly" : "";
      return `<tr data-i="${i}" class="${flag.trim()}">
        <td class="cell-title">${escapeHtml(fmtChartTime(p.t, "full"))}</td>
        <td class="num-secondary">${fmt(p.d)}</td>
        <td class="cell-muted">${fmt(p.r)}</td>
        <td class="cell-muted">${fmt(p.o)}</td>
        <td class="num-primary">${fmt(p.tot)}</td>
        <td class="num-secondary">${escapeHtml(p.eevp == null ? "—" : String(p.eevp) + "%")}</td>
      </tr>`;
    })
    .join("");
  const labels = { time: "time", dem: n.demShort || "Dem", rep: n.repShort || "Rep", total: "total" };
  host.innerHTML = dataPanel({
    title: "Snapshots",
    subtitle: `Sorted by ${sortLabel(sort, labels)}. Showing ${pts.length} of ${pts.length}. Yellow rows are the marked update.`,
    tableCls: "chart-points",
    clickable: true,
    sort: [
      { id: "time", label: "Time", active: sort === "time" },
      { id: "dem", label: n.demShort || "Dem", active: sort === "dem" },
      { id: "rep", label: n.repShort || "Rep", active: sort === "rep" },
      { id: "total", label: "Total", active: sort === "total" },
    ],
    columns: [
      { label: "Time (UTC)" },
      { label: n.demShort || "Dem", cls: "num" },
      { label: n.repShort || "Rep", cls: "num" },
      { label: "Other", cls: "num" },
      { label: "Total", cls: "num" },
      { label: "Expected in", cls: "num" },
    ],
    rowsHtml: rows,
  });
  bindPanelSort(host, (id) => {
    state.chartTableSort = id;
    renderChartPointTable(root, pts);
    const svg = root.querySelector("svg.time-chart");
    if (svg) svg.replaceWith(svg.cloneNode(true));
    bindTimeChartHover(root, state.timeSeries);
  });
}

function isDetailOpen() {
  return $("detail-drawer")?.classList.contains("open");
}

function openDetailDrawer(title) {
  const drawer = $("detail-drawer");
  const backdrop = $("detail-backdrop");
  if (!drawer) return;
  if (title && $("detail-title")) $("detail-title").textContent = title;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.remove("hidden");
  }
  $("detail-close")?.focus();
}

function closeDetailDrawer() {
  const drawer = $("detail-drawer");
  const backdrop = $("detail-backdrop");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.classList.add("hidden");
  }
}

function renderDetail(row) {
  state.selected = row.geoid;
  const n = names();
  const place = [row.stateName, row.countyFips ? `County ${row.countyFips}` : ""]
    .filter(Boolean)
    .join(" · ");
  const raceLine = [n.year, n.office].filter(Boolean).join(" · ");
  const flags = (row.flags || [])
    .map(
      (id) =>
        `<span class="pill" style="--pill:${methodColor(id)}">${escapeHtml(methodName(id))}</span>`,
    )
    .join("");
  $("detail").innerHTML = `
    <section class="detail-block" data-scope="precinct">
      <p class="detail-kicker">Precinct</p>
      <p class="detail-place">${escapeHtml(place || "—")}</p>
      ${raceLine ? `<p class="muted">${escapeHtml(raceLine)}</p>` : ""}
      <div class="detail-metrics">
        <div><b class="accent">${fmt(row.votes_dem)}</b><span>${escapeHtml(n.demShort || "Dem")}</span></div>
        <div><b>${fmt(row.votes_rep)}</b><span>${escapeHtml(n.repShort || "Rep")}</span></div>
        <div><b>${fmt(row.votes_other)}</b><span>Other</span></div>
        <div><b>${fmt(row.votes_total)}</b><span>Total</span></div>
        <div><b>${fmt(row.pct_dem_lead)}</b><span>Lead (pts)</span></div>
        <div><b>${fmt(row.votes_per_sqkm)}</b><span>Votes / km²</span></div>
      </div>
      ${renderShareBar(row, { compact: true })}
      <div class="flags detail-flags">${flags || `<p class="muted">No flags on this precinct.</p>`}</div>
      <div class="workup" id="workup">
        <p class="muted">Loading workup…</p>
      </div>
    </section>
    <section class="detail-block" data-scope="county" id="county-night" hidden></section>
    <section class="detail-block" data-scope="state" id="state-race">
      <p class="muted">Loading state race…</p>
    </section>`;
  if (row.lat != null && row.lng != null) {
    map.setView([row.lat, row.lng], Math.max(map.getZoom(), 9));
    const drawer = $("detail-drawer");
    const shift = drawer ? Math.round(drawer.getBoundingClientRect().width / 2) : 0;
    if (shift && drawer.getBoundingClientRect().width < window.innerWidth * 0.9) {
      map.panBy([-shift, 0], { animate: false });
    }
  }
  openDetailDrawer(row.geoid);
}

function registerWorkups(workups) {
  Object.assign(state.proofPackets, workups || {});
}

function renderWorkup(w, key) {
  if (!w || !w.flags) return `<p class="muted">No workup.</p>`;
  const flags = (w.flags || [])
    .map((f) => {
      const summary = proofSummary(f) || f.why || "";
      return `<article class="proof-flag">
        <h4><span class="pill" style="--pill:${methodColor(f.id)}">${escapeHtml(f.name)}</span></h4>
        ${renderProofBody(f, null, { json: false, summary })}
      </article>`;
    })
    .join("");
  return `
    <div class="workup-head">
      <strong>Proof of work</strong>
    </div>
    ${flags || "<p class='muted'>This precinct has no flags.</p>"}
    ${jsonProofButton(key)}`;
}

async function loadWorkup(geoid) {
  const box = $("workup");
  if (!box) return;
  try {
    const w = await getJson("/api/precincts/" + encodeURIComponent(geoid) + "/workup");
    const key = `precinct-${geoid}`;
    registerWorkups({ [key]: w });
    box.innerHTML = renderWorkup(w, key);
  } catch {
    box.innerHTML = `<p class="muted">Workup unavailable.</p>`;
  }
}

async function loadStateRace(row) {
  const box = $("state-race");
  if (!box) return;
  const fips = row.stateFips;
  const n = names();
  if (!fips) {
    box.innerHTML = "";
    const countyBox = $("county-night");
    if (countyBox) {
      countyBox.hidden = true;
      countyBox.innerHTML = "";
    }
    return;
  }
  try {
    const q = new URLSearchParams({ state: fips });
    if (row.countyFips) q.set("county", row.countyFips);
    const race = await getJson("/api/race?" + q.toString());
    if (race.dem) {
      state.candidates = {
        ...state.candidates,
        dem: race.dem.name,
        demShort: race.dem.last || race.dem.name,
        rep: race.rep?.name || state.candidates.rep,
        repShort: race.rep?.last || state.candidates.repShort,
        year: 2020,
        office: race.office || "President",
      };
    }
    const series = (race.timeseries || []).map((p) => ({
      t: p.t,
      votes_dem: p.votes_dem,
      votes_rep: p.votes_rep,
      votes_total: p.votes,
      eevp: p.eevp,
    }));
    state.timeSeries = series;
    state.timeChartTitle = `${race.name || "State"} election night`;
    const others = (race.others || [])
      .map((c) => `${escapeHtml(c.name)} · ${fmt(c.votes)} (${c.percent ?? "—"}%)`)
      .join("</li><li>");
    const countyBox = $("county-night");
    if (countyBox) {
      if (race.county) {
        const c = race.county;
        const demC = c.results?.[race.dem?.key];
        const repC = c.results?.[race.rep?.key];
        countyBox.hidden = false;
        countyBox.innerHTML = `
          <p class="detail-kicker">County</p>
          <h4>${escapeHtml(c.name || "County")}</h4>
          <p class="muted">${escapeHtml(c.leader || "Night-file county total")}</p>
          <div class="detail-metrics">
            <div><b class="accent">${fmt(demC)}</b><span>${escapeHtml(race.dem?.last || n.demShort || "Dem")}</span></div>
            <div><b>${fmt(repC)}</b><span>${escapeHtml(race.rep?.last || n.repShort || "Rep")}</span></div>
            <div><b>${fmt(c.votes)}</b><span>Total</span></div>
          </div>`;
      } else {
        countyBox.hidden = true;
        countyBox.innerHTML = "";
      }
    }
    box.innerHTML = `
      <p class="detail-kicker">State</p>
      <h4>${escapeHtml(race.name || "State")} election night</h4>
      <p class="muted">${escapeHtml(race.leader || "")}${race.leader ? " · " : ""}${fmt(race.votes)} votes · ${escapeHtml(String(race.eevp ?? "—"))}% expected</p>
      ${renderTimeChart(series.length >= 2 ? series : null)}`;
    const chartRoot = box.querySelector("[data-time-chart]");
    if (chartRoot && series.length >= 2) {
      bindTimeChartHover(chartRoot, series);
      chartRoot.querySelector("[data-enlarge]")?.addEventListener("click", () => {
        state.timeChartMark = null;
        state.timeChartHead = null;
        openTimePopup();
      });
    }
    const stateErrors = (race.findings?.errors || []).filter((e) => e.kind !== "unsorted_series");
    if (stateErrors.length) {
      const raceWorkups = {};
      const cards = stateErrors
        .map((e, i) => {
          const w = e.workup;
          const key = `race-${e.kind}-${i}`;
          if (w) raceWorkups[key] = w;
          return `<article class="proof-flag">
               <p class="proof-item-title">${escapeHtml(e.detail || e.kind)}</p>
               ${w ? renderProofBody(w, key, { summary: findingSummary(e.kind) || e.detail }) : ""}
             </article>`;
        })
        .join("");
      registerWorkups(raceWorkups);
      box.insertAdjacentHTML("beforeend", `<div class="detail-sub"><h5>Notable in this night file</h5>${cards}</div>`);
    }
    const retr = (race.findings?.retractions || []).slice(0, 5);
    if (retr.length) {
      box.insertAdjacentHTML(
        "beforeend",
        `<div class="detail-sub"><h5>Feed retractions</h5>
         <ul class="share-legend">${retr
           .map((r) => `<li>${fmt(r.delta)} votes at ${escapeHtml(String(r.eevp ?? "—"))}% expected · ${escapeHtml(fmtWhen(r.timestamp))}</li>`)
           .join("")}</ul></div>`,
      );
    }
    if (others) {
      box.insertAdjacentHTML("beforeend", `<div class="detail-sub"><h5>Other candidates</h5><ul class="share-legend"><li>${others}</li></ul></div>`);
    }
  } catch {
    state.timeSeries = null;
    box.innerHTML = `<p class="detail-kicker">State</p><p class="muted">No per-state NYT race file for this state.</p>`;
    const countyBox = $("county-night");
    if (countyBox) {
      countyBox.hidden = true;
      countyBox.innerHTML = "";
    }
  }
}

async function select(geoid, cached) {
  const row = cached || (await getJson("/api/precincts/" + encodeURIComponent(geoid)));
  renderDetail(row);
  for (const tr of document.querySelectorAll("#rows tr")) {
    tr.classList.toggle("active", tr.firstElementChild && tr.firstElementChild.textContent === geoid);
  }
  loadWorkup(geoid);
  loadStateRace(row);
}

function precinctTipHtml(props) {
  const flags = Array.isArray(props?.flags) ? props.flags : [];
  const pills = flags
    .map(
      (id) =>
        `<span class="pill" style="--pill:${methodColor(id)}">${escapeHtml(methodName(id))}</span>`,
    )
    .join("");
  return `<b>${escapeHtml(props?.geoid || "Precinct")}</b>
    ${props?.state ? `<span>${escapeHtml(props.state)}</span>` : ""}
    <div class="flags tip-flags">${pills || `<span>No flags</span>`}</div>`;
}

function countyFill(c) {
  if (!c?.winnerParty) return { fill: "#2a3140", opacity: 0.1 };
  const m = Math.min(1, Math.abs(Number(c.margin) || 0) / 40);
  const opacity = 0.16 + 0.48 * m;
  if (c.winnerParty === "democrat") return { fill: "#3b82f6", opacity };
  if (c.winnerParty === "republican") return { fill: "#ef4444", opacity };
  return { fill: "#a78bfa", opacity };
}

function countyTipHtml(c) {
  if (!c) return "";
  const n = names();
  const where = [c.name, c.postal || c.stateName].filter(Boolean).join(", ");
  const lead = c.leader || (c.winner ? `${c.winner} +${Number(c.margin || 0).toFixed(1)}` : "—");
  return `<b>${escapeHtml(where)}</b>
    ${escapeHtml(n.demShort || "Dem")} ${fmt(c.demVotes)} · ${escapeHtml(n.repShort || "Rep")} ${fmt(c.repVotes)}${c.otherVotes ? ` · Other ${fmt(c.otherVotes)}` : ""}<br>
    <span>${escapeHtml(lead)} · ${fmt(c.votes)} votes</span>`;
}

function fillCountyLegend(packet, tally) {
  const box = $("county-legend");
  if (!box) return;
  if (!state.countyOverlay) {
    box.hidden = true;
    box.classList.add("hidden");
    return;
  }
  const dem = packet?.dem?.last || names().demShort || "Dem";
  const rep = packet?.rep?.last || names().repShort || "Rep";
  const year = String(packet?.election_date || "2020").slice(0, 4);
  const kind = tally?.flaggedOnly === false ? "precincts" : "flagged";
  const counts = tally
    ? `<div class="map-legend-row"><i class="dem"></i>${escapeHtml(dem)} <b>${fmt(tally.dem)}</b></div>
    <div class="map-legend-row"><i class="rep"></i>${escapeHtml(rep)} <b>${fmt(tally.rep)}</b></div>
    ${tally.other ? `<div class="map-legend-row"><i class="oth"></i>Other <b>${fmt(tally.other)}</b></div>` : ""}
    ${tally.unknown ? `<div class="map-legend-row"><i class="unk"></i>No county match <b>${fmt(tally.unknown)}</b></div>` : ""}
    <p>${fmt(tally.total)} ${kind} in the current filters, not counting zero-vote precincts or zero-vote county clusters.</p>`
    : `<div class="map-legend-row"><i class="dem"></i>${escapeHtml(dem)}</div>
    <div class="map-legend-row"><i class="rep"></i>${escapeHtml(rep)}</div>
    <p>Counting ${kind} by county winner…</p>`;
  box.innerHTML = `<strong>${escapeHtml(year)} president</strong>${counts}`;
  box.hidden = false;
  box.classList.remove("hidden");
}

async function ensureCountyWinners() {
  if (state.countyWinners) return state.countyWinners;
  state.countyWinners = await getJson("/api/county-winners");
  return state.countyWinners;
}

async function ensureCountyShapes() {
  if (state.countyShapes) return state.countyShapes;
  const res = await fetch("/us-counties.geojson");
  if (!res.ok) throw new Error("county outlines unavailable");
  state.countyShapes = await res.json();
  return state.countyShapes;
}

function selectedStateFips() {
  const v = $("state")?.value || "all";
  return v && v !== "all" ? String(v).padStart(2, "0") : "";
}

async function syncCountyOverlay() {
  if (state.countyLayer) {
    map.removeLayer(state.countyLayer);
    state.countyLayer = null;
  }
  if (!state.countyOverlay) {
    fillCountyLegend(null);
    return;
  }
  try {
    const [packet, shapes] = await Promise.all([ensureCountyWinners(), ensureCountyShapes()]);
    const byFips = packet.counties || {};
    const want = selectedStateFips();
    state.countyLayer = leaflet.geoJSON(shapes, {
      pane: "countyWinners",
      filter(feat) {
        const fips = String(feat.id || feat.properties?.fips || "").padStart(5, "0");
        if (want && fips.slice(0, 2) !== want) return false;
        return Boolean(byFips[fips]);
      },
      style(feat) {
        const fips = String(feat.id || feat.properties?.fips || "").padStart(5, "0");
        const paint = countyFill(byFips[fips]);
        return {
          color: "rgba(8, 10, 16, 0.55)",
          weight: 0.6,
          fillColor: paint.fill,
          fillOpacity: paint.opacity,
        };
      },
      onEachFeature(feat, layer) {
        const fips = String(feat.id || feat.properties?.fips || "").padStart(5, "0");
        const c = byFips[fips];
        if (!c) return;
        layer.bindTooltip(countyTipHtml(c), { className: "county-tip", sticky: true, opacity: 0.96 });
        layer.on("click", () => {
          if ($("q")) $("q").value = c.fips;
          state.page = 0;
          refresh();
        });
      },
    }).addTo(map);
    fillCountyLegend(packet, null);
    const p = qs();
    p.delete("limit");
    p.delete("offset");
    const tally = await getJson("/api/anomalies-by-winner?" + p.toString());
    if (!state.countyOverlay) return;
    fillCountyLegend(packet, tally);
  } catch {
    fillCountyLegend(null);
    showBanner("County winner overlay could not load.", true);
  }
}

async function refreshMap() {
  const p = qs();
  p.delete("limit");
  p.delete("offset");
  const fc = await getJson("/api/anomalies.geojson?" + p.toString());
  if (state.layer) map.removeLayer(state.layer);
  if (!state.mapRenderer) state.mapRenderer = leaflet.canvas({ padding: 0.45, pane: "precincts" });
  const zoom = map.getZoom();
  const radius = zoom >= 8 ? 6 : zoom >= 6 ? 5 : 4;
  state.layer = leaflet.geoJSON(fc, {
    pane: "precincts",
    renderer: state.mapRenderer,
    pointToLayer(feat, latlng) {
      const fill = feat.properties.color || "#8b97b0";
      return leaflet.circleMarker(latlng, {
        pane: "precincts",
        radius,
        color: "#f4f6fb",
        weight: 1,
        opacity: 0.42,
        fillColor: fill,
        fillOpacity: 0.78,
      });
    },
    onEachFeature(feat, layer) {
      layer.on("click", () => select(feat.properties.geoid));
      layer.bindTooltip(precinctTipHtml(feat.properties), {
        className: "county-tip precinct-tip",
        sticky: true,
        opacity: 0.96,
        direction: "top",
      });
    },
  }).addTo(map);
  if (fc.features.length) {
    map.fitBounds(state.layer.getBounds(), { padding: [24, 24], maxZoom: 7 });
  }
  await syncCountyOverlay();
}

async function refresh() {
  const payload = await getJson("/api/anomalies?" + qs().toString());
  renderTable(payload);
  syncLegend();
  await refreshMap();
  setTimeout(() => map.invalidateSize(), 40);
}

async function boot() {
  try {
    const health = await getJson("/api/health");
    if (health.indexing) {
      showBanner(
        "Indexing precinct files… this can take a few minutes on first start. The page will load when ready.",
      );
      setTimeout(boot, 2000);
      return;
    }
    if (!health.ok) {
      showBanner(health.error || "Index failed.", true);
      return;
    }
    showBanner("");
    state.summary = await getJson("/api/summary");
    state.methods = state.summary.methods || [];
    if (state.summary.candidates) state.candidates = state.summary.candidates;
    fillUnmappedNote(state.summary.unmapped || 0, state.summary.precincts || 0);
    fillFilters();
    fillCoverage();
    fillBenford();
    fillBriefing();
    showSection(currentSection());
    await refresh();
  } catch (e) {
    if (e.body && e.body.indexing) {
      showBanner("Indexing precinct files…");
      setTimeout(boot, 2000);
      return;
    }
    showBanner(e.message || "Failed to load ElectionTrace.", true);
  }
}

function currentSection() {
  const h = (location.hash || "#coverage").replace("#", "");
  if (h === "reproduce") return "methods";
  return ["coverage", "files", "patterns", "lab", "methods"].includes(h) ? h : "coverage";
}

function showSection(id) {
  const next = ["coverage", "files", "patterns", "lab", "methods"].includes(id) ? id : "coverage";
  document.body.dataset.section = next;
  document.querySelectorAll(".section-nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === next);
  });
  if (next !== "lab") closeDetailDrawer();
  if (next === "lab") setTimeout(() => map.invalidateSize(), 80);
  const repro = $("reproduce");
  if (repro) {
    const openRepro = next === "methods" && (location.hash || "") === "#reproduce";
    if (openRepro) {
      repro.open = true;
      closeJsonProof();
      setTimeout(() => repro.scrollIntoView({ block: "start" }), 50);
    }
  }
}

function openFileOnly(fips) {
  const name = jurisdictionName(fips);
  const tb = $("rows");
  if (tb) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="6">${escapeHtml(name)} has a night file and no precinct geometry in this extract.</td></tr>`;
  }
  if ($("lab-table-sub")) $("lab-table-sub").textContent = "Night file only — no precinct rows in this extract.";
  if ($("pager")) $("pager").textContent = "Night file only";
  if (state.layer) {
    map.removeLayer(state.layer);
    state.layer = null;
  }
  const box = $("detail");
  if (box) {
    box.innerHTML = `
      <section class="detail-block" data-scope="precinct">
        <p class="detail-kicker">Precinct</p>
        <p class="detail-place">${escapeHtml(name)}</p>
        <p class="muted">No precinct rows in this extract. County and state night-file totals follow.</p>
      </section>
      <section class="detail-block" data-scope="county" id="county-night" hidden></section>
      <section class="detail-block" data-scope="state" id="state-race">
        <p class="muted">Loading state race…</p>
      </section>`;
  }
  openDetailDrawer(name);
  return loadStateRace({ stateFips: fips, stateName: name });
}

function openJurisdiction(fips) {
  location.hash = "lab";
  showSection("lab");
  if ($("state")) $("state").value = fips;
  state.page = 0;
  if (isFileOnly(fips)) return openFileOnly(fips);
  return refresh();
}

$("state").addEventListener("change", () => {
  state.page = 0;
  const fips = $("state").value;
  if (fips && fips !== "all" && isFileOnly(fips)) {
    openFileOnly(fips);
    return;
  }
  refresh();
});

window.addEventListener("hashchange", () => {
  if (isJsonProofOpen()) closeJsonProof();
  showSection(currentSection());
});

$("chart-modal-close")?.addEventListener("click", closeTimePopup);
$("chart-modal")?.addEventListener("click", (e) => {
  if (e.target === $("chart-modal")) closeTimePopup();
});
$("json-modal-close")?.addEventListener("click", closeJsonProof);
$("json-modal")?.addEventListener("click", (e) => {
  if (e.target === $("json-modal")) closeJsonProof();
});
$("json-modal-copy")?.addEventListener("click", () => {
  copyJsonProof();
});
$("json-modal-download")?.addEventListener("click", downloadJsonProof);
$("detail-close")?.addEventListener("click", closeDetailDrawer);
$("detail-backdrop")?.addEventListener("click", closeDetailDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (isJsonProofOpen()) {
    closeJsonProof();
    return;
  }
  if ($("chart-modal") && !$("chart-modal").hidden) {
    closeTimePopup();
    return;
  }
  if (isDetailOpen()) closeDetailDrawer();
});

document.addEventListener("click", (e) => {
  const jsonBtn = e.target.closest("[data-open-json]");
  if (jsonBtn) {
    openJsonProof(jsonBtn.dataset.openJson);
    return;
  }
  const methodLink = e.target.closest("a[data-method]");
  if (methodLink) {
    const id = methodLink.dataset.method;
    state.methodId = id;
    location.hash = "methods";
    showSection("methods");
    fillMethodBoard();
    $("method-card-" + id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  const findingLink = e.target.closest("a[data-finding]");
  if (findingLink) {
    const id = findingLink.dataset.finding;
    const tab = findingLink.dataset.tab === "patterns" ? "patterns" : "files";
    location.hash = tab;
    showSection(tab);
    if (tab === "files") showFilePane(id);
    else showPatternPane(id);
  }
});
if ($("type")) {
  $("type").addEventListener("change", () => {
    state.page = 0;
    refresh();
  });
}
$("prev")?.addEventListener("click", () => {
  if (state.page > 0) {
    state.page -= 1;
    refresh();
  }
});
$("next")?.addEventListener("click", () => {
  state.page += 1;
  refresh();
});
$("all")?.addEventListener("change", () => {
  state.page = 0;
  refresh();
});
$("county-overlay")?.addEventListener("change", () => {
  state.countyOverlay = Boolean($("county-overlay").checked);
  syncCountyOverlay();
});
let t;
$("q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => {
    state.page = 0;
    refresh();
  }, 250);
});

map.on("zoomend", () => {
  if (!state.layer) return;
  const z = map.getZoom();
  const r = z >= 8 ? 6 : z >= 6 ? 5 : 4;
  state.layer.eachLayer((ly) => {
    if (ly.setRadius) ly.setRadius(r);
  });
});

boot();
