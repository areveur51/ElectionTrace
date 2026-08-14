import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const js = readFileSync(join(root, "app/public/app.js"), "utf8");
const css = readFileSync(join(root, "app/public/styles.css"), "utf8");
const html = readFileSync(join(root, "app/public/index.html"), "utf8");
const proof = readFileSync(join(root, "app/public/proof.mjs"), "utf8");

test("unmapped map note is a lab callout with count, copy, and dismiss", () => {
  assert.match(html, /id="unmapped-note"/);
  assert.match(js, /function fillUnmappedNote\(/);
  assert.match(js, /No usable map point/);
  assert.match(js, /Still scanned and can still be flagged/);
  assert.match(js, /no pin on the map/);
  assert.match(js, /data-dismiss-unmapped/);
  assert.match(css, /\.map-note\s*\{/);
  assert.match(css, /\.map-note-stat/);
});

test("Precinct lab state dropdown is sorted alphabetically by name", () => {
  assert.match(js, /function fillFilters\(/);
  assert.match(js, /localeCompare\(String\(b\.name/);
});

test("top nav and View JSON buttons include icons", () => {
  assert.match(html, /class="btn-icon"/);
  assert.match(html, /data-nav="coverage"[\s\S]{0,200}<svg class="btn-icon"/);
  assert.match(html, /id="json-modal-copy"[\s\S]{0,160}<svg class="btn-icon"/);
  assert.match(proof, /JSON_ICON/);
  assert.match(proof, /class="btn-icon"/);
  assert.match(css, /\.btn-icon/);
});

test("Precinct lab methods are wrap pills with counts, not a scroll strip", () => {
  assert.match(js, /class="lab-method-pill/);
  assert.match(js, /lab-method-pill-count/);
  assert.doesNotMatch(js, /lab-method-switch[\s\S]{0,400}class="board-row/);
  assert.match(css, /\.lab-method-board\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.doesNotMatch(css, /\.lab-method-board\s*\{[^}]*overflow-x:\s*auto/);
  assert.doesNotMatch(css, /\.lab-method-board\s*\{[^}]*mask-image/);
});

test("Precinct lab detail pane lists precinct first, then county, then state", () => {
  assert.match(js, /data-scope="precinct"/);
  assert.match(js, /data-scope="county"/);
  assert.match(js, /data-scope="state"/);
  assert.match(js, /id="workup"[\s\S]{0,400}id="county-night"[\s\S]{0,200}id="state-race"/);
  assert.match(js, /detail-kicker">Precinct/);
  assert.match(js, /detail-kicker">County/);
  assert.match(js, /detail-kicker">State/);
  assert.match(css, /\.detail-block/);
  assert.match(css, /\.detail-metrics/);
});

test("short explanations render as What / Why flagged / Why unusual cards", () => {
  assert.match(js, /function explainCards\(/);
  assert.match(js, /What this is/);
  assert.match(js, /Why it is flagged/);
  assert.match(js, /Why that is unusual/);
  assert.match(js, /class="explain-cards"/);
  assert.match(js, /class="explain-card"/);
  assert.match(js, /\$\{explainCards\(m\.plain\)\}/);
  assert.match(css, /\.explain-cards\s*\{/);
  assert.match(css, /\.method-catalog\s*\{/);
});

test("night-of preview cards include proof of work under the chart", () => {
  assert.match(js, /function renderCardWorkup\(/);
  assert.match(js, /renderProofFold\(w, key/);
  assert.match(js, /data-night-chart="\$\{i\}"[\s\S]{0,80}\$\{renderCardWorkup\(r\.workup/);
  assert.match(js, /registerWorkups\(nightCardWorkups\(view\.items\)\)/);
  assert.match(js, /function nightCardHead\(/);
  assert.match(js, /function nightFactsHtml\(/);
  assert.match(js, /state\.timeChartHead = nightCardHead/);
  assert.match(js, /night-popup-why/);
  assert.match(js, /class="time-chart-frame"/);
  assert.match(css, /\.time-chart-frame/);
  assert.match(js, /findingSummary\(type\)/);
  assert.match(html, /id="chart-modal-facts"/);
  assert.match(css, /\.night-popup-facts/);
  assert.doesNotMatch(
    js,
    /function showPatternPane[\s\S]{0,800}renderTableWorkup\(packet/,
  );
});

test("night-of page uses a slim method header, not three explain cards", () => {
  assert.match(html, /class="page page-wide page-night"/);
  assert.match(js, /function nightHead\(/);
  assert.match(js, /function nightView\(/);
  assert.match(js, /id === "feed_vote_switch"/);
  assert.match(js, /function nightHitsHtml\(/);
  assert.match(css, /\.method-night-hits/);
  assert.match(js, /class="night-method"/);
  assert.match(js, /class="night-card"/);
  assert.match(js, /class="night-grid"/);
  assert.match(css, /\.night-grid\s*\{/);
  assert.match(css, /minmax\(16\.5rem/);
  assert.match(css, /\.night-card\s*\{/);
  assert.match(js, /preview \? 68/);
  assert.doesNotMatch(
    js,
    /function showPatternPane[\s\S]{0,500}paneHead\(/,
  );
  assert.doesNotMatch(
    js,
    /function showPatternPane[\s\S]{0,500}explainCards\(/,
  );
});

test("proof of work is DRY and opens JSON in a popup", () => {
  assert.match(js, /from "\.\/proof\.mjs"/);
  assert.match(proof, /export function renderProofBody\(/);
  assert.match(proof, /export function formatRuleHtml\(/);
  assert.match(proof, /data-open-json=/);
  assert.match(js, /function openJsonProof\(/);
  assert.match(js, /highlightJson\(/);
  assert.match(js, /digestHtml\(packet\.sha256\)/);
  assert.match(js, /reproduceHtml\(packet\)/);
  assert.match(html, /id="json-modal-repro"/);
  assert.match(html, /id="reproduce"/);
  assert.match(html, /Reproduce a proof/);
  assert.match(css, /\.json-repro/);
  assert.doesNotMatch(js, /copy-table-workup/);
  assert.doesNotMatch(js, /id="copy-workup"/);
  assert.doesNotMatch(proof, /Copy JSON/);
  assert.match(html, /id="json-modal"/);
  assert.match(html, /id="json-modal-sha"/);
  assert.match(html, /type="module" src="\/app\.js"/);
  assert.match(css, /\.rule-clause/);
  assert.match(css, /\.json-pre/);
  assert.match(css, /\.json-key/);
});

test("Precinct lab map hover includes flag pills", () => {
  assert.match(js, /function precinctTipHtml\(/);
  assert.match(js, /bindTooltip\(precinctTipHtml\(/);
  assert.match(js, /class="pill"/);
  assert.match(css, /\.tip-flags/);
});

test("Precinct lab map has a county presidential winner overlay control", () => {
  assert.match(html, /id="county-overlay"[^>]*checked/);
  assert.match(html, /County presidential winner/);
  assert.match(html, /id="county-legend"/);
  assert.match(js, /function syncCountyOverlay\(/);
  assert.match(js, /\/api\/county-winners/);
  assert.match(js, /\/api\/anomalies-by-winner/);
  assert.match(js, /map-legend-votes/);
  assert.match(js, /tally\?\.votes/);
  assert.match(js, /Plus, minus, and net votes change as more anomalies are detected/);
  assert.match(readFileSync(join(root, "app/server.mjs"), "utf8"), /excludeZeroVotes:\s*true/);
  assert.match(
    readFileSync(join(root, "app/lib/db.mjs"), "utf8"),
    /NOT \('zero_votes' = ANY\(flags\) OR 'zero_cluster' = ANY\(flags\)\)/,
  );
  assert.match(js, /us-counties\.geojson/);
  assert.match(css, /\.map-legend/);
  assert.match(css, /#lab #map \{ height: 520px/);
});

test("In the files and Night-of count use wrap pills, not a sidebar", () => {
  assert.match(js, /function renderTypeSwitch[\s\S]{0,500}renderCountPills/);
  assert.match(js, /function renderCountPills[\s\S]{0,400}lab-method-pill/);
  assert.doesNotMatch(js, /function renderTypeSwitch[\s\S]{0,600}board-row/);
  assert.match(html, /lab-method-board" id="file-switch"/);
  assert.match(html, /lab-method-board night-pills" id="pattern-switch"/);
  assert.doesNotMatch(html, /id="files"[\s\S]{0,500}board-split/);
  assert.doesNotMatch(html, /id="patterns"[\s\S]{0,500}board-split/);
  assert.match(html, /id="files"[\s\S]{0,200}page-wide/);
  assert.match(html, /id="patterns"[\s\S]{0,200}page-wide/);
  assert.match(css, /\.page-wide/);
});
