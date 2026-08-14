import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCheckValueHtml,
  formatRuleHtml,
  highlightJson,
  renderProofBody,
  renderProofFold,
  tokenizeRule,
} from "../app/public/proof.mjs";

test("tokenizes comparisons, indexes, and conjunctions", () => {
  const types = tokenizeRule("votes[i] - votes[i-1] <= -1000").map((t) => t.type);
  assert.deepEqual(types, ["id", "idx", "op", "id", "idx", "op", "num"]);
  const pretty = tokenizeRule("votes[i] - votes[i-1] <= -1000").map((t) => t.text);
  assert.ok(pretty.includes("≤"));
  assert.ok(pretty.includes("−"));
  assert.ok(pretty.some((t) => t.includes("1,000")));
});

test("formats stacked and-clauses as separate rule chips", () => {
  const html = formatRuleHtml(
    "votes_prev >= 50000 and eevp >= 40 and sign(share_dem − share_rep) flipped",
  );
  assert.match(html, /class="rule-kicker">Rule/);
  assert.match(html, /class="rule-join">and/);
  assert.equal((html.match(/class="rule-clause"/g) || []).length, 3);
  assert.match(html, /50,000/);
  assert.match(html, /rule-fn">sign/);
});

test("proof body has one View JSON button and no inline copy/download", () => {
  const html = renderProofBody(
    {
      rule: "votes_total == 0",
      why: "The precinct published a total of zero ballots.",
      checks: [{ expr: "votes_total == 0", left: 0, right: 0, ok: true }],
      sha256: "abc123def456",
    },
    "night-0",
  );
  assert.match(html, /class="proof-summary">The precinct published a total of zero ballots/);
  assert.match(html, /data-open-json="night-0"/);
  assert.match(html, />View JSON</);
  assert.doesNotMatch(html, /Copy JSON/);
  assert.doesNotMatch(html, /Download/);
  assert.doesNotMatch(html, /abc123def456/);
  assert.doesNotMatch(html, /digest-label/);
  assert.match(html, /rule-op">=/);
  const fold = renderProofFold(
    { rule: "votes_total == 0", sha256: "abc123def4567890" },
    "night-0",
    { variant: "card" },
  );
  assert.match(fold, />Proof of work</);
  assert.doesNotMatch(fold, /abc123def456/);
});

test("highlights JSON keys, strings, numbers, and keywords", () => {
  const html = highlightJson(`{\n  "ok": true,\n  "n": 12,\n  "note": "hi <x>",\n  "empty": null\n}`);
  assert.match(html, /json-key">"ok"/);
  assert.match(html, /json-bool">true/);
  assert.match(html, /json-num">12/);
  assert.match(html, /json-str">"hi &lt;x&gt;"/);
  assert.match(html, /json-null">null/);
  assert.doesNotMatch(html, /<x>/);
});

test("check values pretty-print objects instead of raw JSON walls", () => {
  const html = formatCheckValueHtml({ from: 12000, to: 8000 });
  assert.match(html, /class="check-k">from/);
  assert.match(html, /12,000/);
  assert.doesNotMatch(html, /\{"from"/);
});
