/** Shared proof-of-work rendering. Used by the static UI and unit tests. */

const FUNCS = new Set(["abs", "exists", "for", "max", "min", "round", "sign", "sum"]);
const OPS = {
  "<=": "≤",
  ">=": "≥",
  "==": "=",
  "!=": "≠",
  "-": "−",
  "*": "×",
};
const MULTI_OPS = ["<=", ">=", "==", "!="];
const SINGLE_OPS = new Set(["<", ">", "+", "-", "*", "/", "=", "−", "×", "·"]);

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isIdentStart(ch) {
  return /[A-Za-zΔ_]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9Δ_]/.test(ch);
}

export function tokenizeRule(rule) {
  const src = String(rule || "");
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) {
      tokens.push({ type: "op", raw: two, text: OPS[two] || two });
      i += 2;
      continue;
    }
    if (ch === "[" ) {
      const end = src.indexOf("]", i + 1);
      const raw = end === -1 ? src.slice(i) : src.slice(i, end + 1);
      tokens.push({ type: "idx", raw, text: raw });
      i += raw.length;
      continue;
    }
    if ((ch === "+" || ch === "-") && /\d/.test(src[i + 1] || "")) {
      let j = i + 1;
      while (j < src.length && /\d/.test(src[j])) j += 1;
      if (src[j] === "." && /\d/.test(src[j + 1] || "")) {
        j += 1;
        while (j < src.length && /\d/.test(src[j])) j += 1;
      }
      if (src[j] === "%") j += 1;
      const raw = src.slice(i, j);
      tokens.push({ type: "num", raw, text: prettyNum(raw) });
      i = j;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < src.length && /\d/.test(src[j])) j += 1;
      if (src[j] === "." && /\d/.test(src[j + 1] || "")) {
        j += 1;
        while (j < src.length && /\d/.test(src[j])) j += 1;
      }
      if (src[j] === "%") j += 1;
      const raw = src.slice(i, j);
      tokens.push({ type: "num", raw, text: prettyNum(raw) });
      i = j;
      continue;
    }
    if (SINGLE_OPS.has(ch)) {
      tokens.push({ type: "op", raw: ch, text: OPS[ch] || ch });
      i += 1;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j])) j += 1;
      while (src[j] === "." && isIdentStart(src[j + 1] || "")) {
        j += 1;
        while (j < src.length && isIdentPart(src[j])) j += 1;
      }
      const raw = src.slice(i, j);
      if (raw === "and" || raw === "or") tokens.push({ type: "join", raw, text: raw });
      else if (FUNCS.has(raw)) tokens.push({ type: "fn", raw, text: raw });
      else tokens.push({ type: "id", raw, text: raw });
      i = j;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", raw: ch, text: ch });
      i += 1;
      continue;
    }
    tokens.push({ type: "word", raw: ch, text: ch });
    i += 1;
  }
  return tokens;
}

function prettyNum(raw) {
  if (raw.endsWith("%")) {
    const n = Number(raw.slice(0, -1));
    return Number.isFinite(n) ? `${n.toLocaleString()}%` : raw;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n.toLocaleString() : raw;
}

export function splitClauses(tokens) {
  const clauses = [];
  let cur = [];
  let join = null;
  for (const t of tokens) {
    if (t.type === "join") {
      if (cur.length) clauses.push({ tokens: cur, joinBefore: join });
      join = t.text;
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) clauses.push({ tokens: cur, joinBefore: join });
  return clauses;
}

function tokenHtml(t) {
  return `<span class="rule-tok rule-${t.type}">${escapeHtml(t.text)}</span>`;
}

export function formatRuleHtml(rule, opts = {}) {
  if (!rule) return "";
  const tokens = tokenizeRule(rule);
  if (!tokens.length) return "";
  const stacked = opts.stacked !== false && tokens.some((t) => t.type === "join");
  const kicker = opts.kicker === undefined ? "Rule" : opts.kicker;
  const clauses = stacked ? splitClauses(tokens) : [{ tokens, joinBefore: null }];
  const body = clauses
    .map((c) => {
      const join = c.joinBefore ? `<div class="rule-join">${escapeHtml(c.joinBefore)}</div>` : "";
      return `${join}<div class="rule-clause">${c.tokens.map(tokenHtml).join("")}</div>`;
    })
    .join("");
  const head = kicker ? `<div class="rule-kicker">${escapeHtml(kicker)}</div>` : "";
  return `<div class="rule-block">${head}<div class="rule-clauses">${body}</div></div>`;
}

export function formatExprHtml(expr) {
  if (!expr) return "";
  return `<span class="rule-inline">${tokenizeRule(expr).map(tokenHtml).join("")}</span>`;
}

export function formatScalar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(v);
}

export function formatCheckValueHtml(v) {
  if (v === undefined) return "—";
  if (v === null) return "";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const shown = v.slice(0, 12).map((item) => escapeHtml(formatScalar(item)));
    const extra = v.length > 12 ? `<span class="check-more">+${v.length - 12}</span>` : "";
    return `<span class="check-list">${shown.join("<span class='check-sep'>, </span>")}${extra}</span>`;
  }
  if (typeof v === "object") {
    return Object.entries(v)
      .map(
        ([k, val]) =>
          `<span class="check-kv"><span class="check-k">${escapeHtml(k)}</span> ${formatCheckValueHtml(val)}</span>`,
      )
      .join("");
  }
  return `<span class="check-scalar">${escapeHtml(formatScalar(v))}</span>`;
}

export function renderChecks(checks) {
  if (!checks || !checks.length) return "";
  return `<ul class="checks">${checks
    .map((c) => {
      const left = c.left === undefined ? "" : formatCheckValueHtml(c.left);
      const right = c.right === undefined || c.right === null ? "" : formatCheckValueHtml(c.right);
      const vals =
        !left && !right
          ? ""
          : `<span class="check-vals">${left}${right ? `<span class="check-vs">vs</span>${right}` : ""}</span>`;
      return `<li class="${c.ok ? "ok" : "no"}">${formatExprHtml(c.expr)}${vals}</li>`;
    })
    .join("")}</ul>`;
}

export function digestHtml(sha) {
  if (!sha) return "";
  return `<p class="digest"><span class="digest-label">SHA-256</span> <code>${escapeHtml(sha)}</code></p>`;
}

export function shortDigest(sha, n = 12) {
  if (!sha) return "";
  return `<code class="digest-inline">${escapeHtml(String(sha).slice(0, n))}…</code>`;
}

const JSON_ICON =
  '<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5c-1.4 0-2 .8-2 2v1.2c0 .7-.6 1.3-1.3 1.3.7 0 1.3.6 1.3 1.3V11c0 1.2.6 2 2 2"/><path d="M11 3.5c1.4 0 2 .8 2 2v1.2c0 .7.6 1.3 1.3 1.3-.7 0-1.3.6-1.3 1.3V11c0 1.2-.6 2-2 2"/></svg>';

export function jsonProofButton(key, label = "View JSON") {
  if (!key) return "";
  return `<div class="workup-actions">
    <button type="button" class="page-btn proof-json-btn" data-open-json="${escapeHtml(key)}">${JSON_ICON}${escapeHtml(label)}</button>
  </div>`;
}

export function proofSummary(w, extra) {
  if (extra) return extra;
  if (!w) return "";
  return (
    w.summary ||
    w.why ||
    w.plain?.whyAnomaly ||
    w.plain?.whyFlagged ||
    w.plain?.about ||
    ""
  );
}

export function renderProofBody(w, key, opts = {}) {
  if (!w) return "";
  const showJson = opts.json !== false && key;
  const summary = proofSummary(w, opts.summary);
  return `<div class="proof-body">
    ${summary ? `<p class="proof-summary">${escapeHtml(summary)}</p>` : ""}
    ${formatRuleHtml(w.rule || "")}
    ${renderChecks(w.checks)}
    ${showJson ? jsonProofButton(key) : ""}
  </div>`;
}

export function renderProofFold(w, key, opts = {}) {
  if (!w) return "";
  const variant = opts.variant || "";
  const foldCls = variant === "card" ? "proof-fold card-proof" : "proof-fold";
  return `<details class="${foldCls}" open data-workup="${escapeHtml(key)}">
    <summary>Proof of work</summary>
    ${renderProofBody(w, key, opts)}
  </details>`;
}

export function renderTableWorkup(packet, id) {
  if (!packet) return "";
  const items = (packet.items || []).filter(Boolean);
  const rows = items
    .map((w, i) => {
      const title = [w.state, w.type || w.label].filter(Boolean).join(" · ");
      const summary = proofSummary(w) || title;
      return `<div class="proof-item">
        ${title ? `<p class="proof-item-title">${escapeHtml(title)}</p>` : ""}
        ${renderProofBody(w, `${id}-item-${i}`, { json: false, summary })}
      </div>`;
    })
    .join("");
  return `<details class="proof-fold" open data-workup="${escapeHtml(id)}">
    <summary>Proof of work</summary>
    ${packet.rule ? formatRuleHtml(packet.rule) : ""}
    ${rows || "<p class='muted'>No row packets.</p>"}
    ${jsonProofButton(id)}
  </details>`;
}

function identAfter(src, i) {
  return /[A-Za-z0-9_]/.test(src[i] || "");
}

/** Syntax-highlight a JSON string. Tokens are HTML-escaped. */
export function highlightJson(text) {
  const src = String(text ?? "");
  let i = 0;
  let html = "";
  const push = (cls, raw) => {
    html += `<span class="${cls}">${escapeHtml(raw)}</span>`;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      const raw = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k += 1;
      push(src[k] === ":" ? "json-key" : "json-str", raw);
      i = j;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const m = src.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (m) {
        push("json-num", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (src.startsWith("true", i) && !identAfter(src, i + 4)) {
      push("json-bool", "true");
      i += 4;
      continue;
    }
    if (src.startsWith("false", i) && !identAfter(src, i + 5)) {
      push("json-bool", "false");
      i += 5;
      continue;
    }
    if (src.startsWith("null", i) && !identAfter(src, i + 4)) {
      push("json-null", "null");
      i += 4;
      continue;
    }
    if ("{}[],:".includes(ch)) {
      push("json-punc", ch);
      i += 1;
      continue;
    }
    html += /\s/.test(ch) ? ch : escapeHtml(ch);
    i += 1;
  }
  return html;
}
