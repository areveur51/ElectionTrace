import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTimeseries,
  analyzeRace,
  summarizeFindings,
  sealWorkup,
  buildCoverage,
  FINDING_TYPES,
  ERROR_TYPES,
} from "../app/lib/nytAnomalies.mjs";
import { METHOD_BY_ID } from "../app/lib/methods.mjs";

describe("NYT feed findings", () => {
  it("documents every finding type in plain language", () => {
    for (const t of FINDING_TYPES) {
      assert.ok(t.about && t.whyFlagged && t.whyAnomaly, t.id);
      assert.doesNotMatch(
        `${t.about} ${t.whyFlagged} ${t.whyAnomaly}`,
        /not a verdict|look closer|not a conclusion/i,
      );
    }
  });

  it("points file and night-of types at a real precinct method when the comparison matches", () => {
    const mapped = [...ERROR_TYPES, ...FINDING_TYPES].filter((t) => t.sameMethod);
    assert.ok(mapped.some((t) => t.id === "feed_retraction" && t.sameMethod === "count_retraction"));
    assert.ok(mapped.some((t) => t.id === "onesided_dump" && t.sameMethod === "one_sided_increment"));
    assert.ok(mapped.some((t) => t.id === "implied_negative_candidate" && t.sameMethod === "vote_transfer"));
    assert.ok(mapped.some((t) => t.id === "county_vs_state" && t.sameMethod === "lead_mismatch"));
    for (const t of mapped) {
      assert.ok(METHOD_BY_ID[t.sameMethod], t.id);
    }
    assert.equal(ERROR_TYPES.find((t) => t.id === "unsorted_series").sameMethod, null);
    assert.equal(FINDING_TYPES.find((t) => t.id === "lead_flip").sameMethod, null);
    assert.equal(ERROR_TYPES.find((t) => t.id === "feed_retraction").tab, "patterns");
    assert.equal(ERROR_TYPES.find((t) => t.id === "implied_negative_candidate").tab, "patterns");
    assert.equal(ERROR_TYPES.find((t) => t.id === "eevp_backwards").tab, "patterns");
    assert.equal(FINDING_TYPES.find((t) => t.id === "onesided_dump").tab, "patterns");
    assert.equal(FINDING_TYPES.find((t) => t.id === "county_clean_math").tab, "files");
  });

  it("documents every file-anomaly type in plain language", () => {
    for (const t of ERROR_TYPES) {
      assert.ok(t.about && t.whyAnomaly && t.note, t.id);
      assert.doesNotMatch(t.whyAnomaly, /fraud|not a verdict|look closer/i);
    }
    const ids = ERROR_TYPES.map((t) => t.id);
    assert.ok(ids.includes("unsorted_series"));
    assert.ok(ids.includes("county_vs_state"));
    assert.ok(ids.includes("implied_negative_candidate"));
    assert.ok(ids.includes("eevp_backwards"));
    assert.ok(ids.includes("feed_retraction"));
    assert.ok(!ids.includes("onesided_dump"));
    assert.ok(!ids.includes("lead_flip"));
    assert.ok(!ids.includes("county_clean_math"));
  });

  it("flags a 5,000-vote retraction and labels it an error", () => {
    const ts = [
      { votes: 100000, eevp: 50, timestamp: "2020-11-04T01:00:00Z", vote_shares: { bidenj: 0.48, trumpd: 0.5 } },
      { votes: 95000, eevp: 50, timestamp: "2020-11-04T01:05:00Z", vote_shares: { bidenj: 0.48, trumpd: 0.5 } },
    ];
    const out = analyzeTimeseries(ts, { name: "Test" });
    assert.equal(out.retractions.length, 1);
    assert.equal(out.retractions[0].delta, -5000);
    assert.equal(out.errors.filter((e) => e.kind === "feed_retraction").length, 1);
  });

  it("does not treat a 200-vote dip as a retraction", () => {
    const ts = [
      { votes: 100000, eevp: 80, timestamp: "t1", vote_shares: { bidenj: 0.5, trumpd: 0.48 } },
      { votes: 99800, eevp: 80, timestamp: "t2", vote_shares: { bidenj: 0.5, trumpd: 0.48 } },
    ];
    assert.equal(analyzeTimeseries(ts).retractions.length, 0);
  });

  it("flags a late lead flip and a one-sided dump without calling them errors", () => {
    const ts = [
      { votes: 2_000_000, eevp: 70, timestamp: "t1", vote_shares: { bidenj: 0.48, trumpd: 0.51 } },
      { votes: 2_200_000, eevp: 85, timestamp: "t2", vote_shares: { bidenj: 0.505, trumpd: 0.48 } },
    ];
    const out = analyzeTimeseries(ts, { name: "Test" });
    assert.equal(out.flips.length, 1);
    assert.equal(out.dumps.length, 1);
    assert.equal(out.dumps[0].who, "Biden");
    assert.ok(out.flips[0].demGain > 0);
    assert.ok(out.flips[0].repGain < 0 || out.flips[0].demGain > out.flips[0].repGain);
    assert.ok(Array.isArray(out.flips[0].series));
    assert.ok(out.flips[0].series.length >= 2);
    assert.ok(out.flips[0].series.every((p) => "votes_dem" in p && "votes_rep" in p));
    assert.ok(out.dumps[0].series.length >= 2);
    const drop = analyzeTimeseries(
      [
        { votes: 100000, eevp: 50, timestamp: "2020-11-04T01:00:00Z", vote_shares: { bidenj: 0.48, trumpd: 0.5 } },
        { votes: 95000, eevp: 50, timestamp: "2020-11-04T01:05:00Z", vote_shares: { bidenj: 0.48, trumpd: 0.5 } },
      ],
      { name: "Test" },
    );
    assert.ok(drop.retractions[0].series.length >= 2);
    assert.equal(out.errors.filter((e) => e.kind === "onesided_dump" || e.kind === "lead_flip").length, 0);
  });

  it("labels an unsorted timeline as a file-structure error", () => {
    const ts = [
      { votes: 0, eevp: 0, timestamp: "2020-11-04T10:00:00Z", vote_shares: { bidenj: 0, trumpd: 0 } },
      { votes: 100, eevp: 5, timestamp: "2020-11-04T01:00:00Z", vote_shares: { bidenj: 0.5, trumpd: 0.5 } },
    ];
    const out = analyzeTimeseries(ts, { name: "Test" });
    assert.equal(out.errors.filter((e) => e.kind === "unsorted_series").length, 1);
    assert.equal(out.errors[0].n, 1);
  });

  it("labels an expected-vote drop of more than 5 points as an error", () => {
    const ts = [
      { votes: 100000, eevp: 99, timestamp: "t1", vote_shares: { bidenj: 0.5, trumpd: 0.48 } },
      { votes: 110000, eevp: 86, timestamp: "t2", vote_shares: { bidenj: 0.5, trumpd: 0.48 } },
    ];
    const out = analyzeTimeseries(ts, { name: "Arizona" });
    const ev = out.errors.filter((e) => e.kind === "eevp_backwards");
    assert.equal(ev.length, 1);
    assert.equal(ev[0].from, 99);
    assert.equal(ev[0].to, 86);
  });

  it("labels share × total implying a 5,000-vote candidate loss as an error", () => {
    const ts = [
      { votes: 100000, eevp: 40, timestamp: "t1", vote_shares: { bidenj: 0.5, trumpd: 0.48 } },
      { votes: 110000, eevp: 45, timestamp: "t2", vote_shares: { bidenj: 0.4, trumpd: 0.58 } },
    ];
    const out = analyzeTimeseries(ts, { name: "Test" });
    const ph = out.errors.filter((e) => e.kind === "implied_negative_candidate");
    assert.equal(ph.length, 1);
    assert.equal(ph[0].who, "Biden");
    assert.ok(ph[0].worst <= -5000);
  });

  it("labels county-sum vs state-total disagreement as an error", () => {
    const out = analyzeRace({
      state_name: "California",
      votes: 1_000_000,
      candidates: [
        { party_id: "democrat", candidate_key: "bidenj" },
        { party_id: "republican", candidate_key: "trumpd" },
      ],
      counties: [
        { votes: 800_000, results: { bidenj: 500_000, trumpd: 300_000 } },
        { votes: 519_560, results: { bidenj: 300_000, trumpd: 219_560 } },
      ],
      timeseries: [],
    });
    assert.equal(out.countyMismatch, 0);
    const vs = out.errors.filter((e) => e.kind === "county_vs_state");
    assert.equal(vs.length, 1);
    assert.equal(vs[0].delta, 319560);
  });

  it("does not treat internally consistent county columns as an error", () => {
    const out = analyzeRace({
      state_name: "Clean",
      votes: 1000,
      candidates: [
        { party_id: "democrat", candidate_key: "bidenj" },
        { party_id: "republican", candidate_key: "trumpd" },
      ],
      counties: [{ votes: 1000, results: { bidenj: 510, trumpd: 490 } }],
      timeseries: [
        { votes: 100, eevp: 10, timestamp: "2020-11-04T01:00:00Z", vote_shares: { bidenj: 0.5, trumpd: 0.5 } },
        { votes: 1000, eevp: 90, timestamp: "2020-11-04T02:00:00Z", vote_shares: { bidenj: 0.51, trumpd: 0.49 } },
      ],
    });
    assert.equal(out.countyMismatch, 0);
    assert.equal(out.errors.filter((e) => e.kind === "county_vs_state").length, 0);
  });

  it("summarizeFindings exposes errorTypes and a labeled error list", () => {
    const byFips = {
      "06": {
        findings: {
          retractions: [],
          flips: [],
          dumps: [],
          errors: [
            { kind: "county_vs_state", state: "California", detail: "counties sum 1 vs state total 2", delta: -1 },
          ],
          countyMismatch: 0,
        },
      },
    };
    const sum = summarizeFindings(byFips);
    assert.ok(Array.isArray(sum.errorTypes));
    assert.equal(sum.counts.errors, 1);
    assert.equal(sum.counts.errorByKind.county_vs_state, 1);
    assert.equal(sum.errors[0].kind, "county_vs_state");
    assert.equal(sum.disclaimer, undefined);
    assert.equal(sum.workups.byKind.county_vs_state.disclaimer, undefined);
    assert.equal(sum.workups.byKind.county_vs_state.kind, "electiontrace.table-workup");
    assert.equal(sum.workups.byKind.county_vs_state.label, "anomaly");
    assert.match(sum.workups.byKind.county_vs_state.sha256, /^[a-f0-9]{64}$/);
  });

  it("attaches a sealed workup to a retraction", () => {
    const ts = [
      { votes: 100000, eevp: 50, timestamp: "2020-11-04T01:00:00Z", vote_shares: { bidenj: 0.48, trumpd: 0.5 } },
      { votes: 95000, eevp: 50, timestamp: "2020-11-04T01:05:00Z", vote_shares: { bidenj: 0.48, trumpd: 0.5 } },
    ];
    const w = analyzeTimeseries(ts, { name: "Test" }).retractions[0].workup;
    assert.equal(w.kind, "electiontrace.feed-workup");
    assert.equal(w.label, "anomaly");
    assert.equal(w.type, "feed_retraction");
    assert.equal(w.inputs.prev.votes, 100000);
    assert.equal(w.inputs.next.votes, 95000);
    assert.ok(w.checks.every((c) => c.ok));
    assert.match(w.sha256, /^[a-f0-9]{64}$/);
    assert.equal(w.disclaimer, undefined);
    assert.doesNotMatch(JSON.stringify(w), /look-closer|not a verdict/i);
    assert.equal(sealWorkup(w).sha256, w.sha256);
  });

  it("labels dump and flip workups as pattern", () => {
    const ts = [
      { votes: 2_000_000, eevp: 70, timestamp: "t1", vote_shares: { bidenj: 0.48, trumpd: 0.51 } },
      { votes: 2_200_000, eevp: 85, timestamp: "t2", vote_shares: { bidenj: 0.505, trumpd: 0.48 } },
    ];
    const out = analyzeTimeseries(ts, { name: "Test" });
    assert.equal(out.dumps[0].workup.label, "pattern");
    assert.equal(out.flips[0].workup.label, "pattern");
    assert.ok(out.dumps[0].workup.checks.every((c) => c.ok));
    assert.ok(out.flips[0].workup.checks.every((c) => c.ok));
  });

  it("puts county votes in the county-vs-state workup", () => {
    const out = analyzeRace({
      state_name: "California",
      votes: 1_000_000,
      candidates: [
        { party_id: "democrat", candidate_key: "bidenj" },
        { party_id: "republican", candidate_key: "trumpd" },
      ],
      counties: [
        { name: "A", fips: "06001", votes: 800_000, results: { bidenj: 500_000, trumpd: 300_000 } },
        { name: "B", fips: "06003", votes: 519_560, results: { bidenj: 300_000, trumpd: 219_560 } },
      ],
      timeseries: [],
    });
    const w = out.errors.find((e) => e.kind === "county_vs_state").workup;
    assert.equal(w.label, "anomaly");
    assert.equal(w.inputs.countySum, 1_319_560);
    assert.equal(w.inputs.counties.length, 2);
    assert.ok(w.checks.every((c) => c.ok));
  });
});

describe("coverage of precinct extract vs night files", () => {
  it("lists AL, AK, LA, VA when those FIPS are absent from the precinct index", () => {
    const precinct = [
      { fips: "06", name: "California" },
      { fips: "11", name: "District of Columbia" },
      { fips: "42", name: "Pennsylvania" },
    ];
    const nyt = Object.fromEntries(
      ["01", "02", "06", "11", "22", "42", "51"].map((f) => [f, { name: f }]),
    );
    const cov = buildCoverage(precinct, nyt);
    assert.equal(cov.counts.expected, 51);
    assert.equal(cov.workup.kind, "electiontrace.coverage-workup");
    assert.match(cov.workup.sha256, /^[a-f0-9]{64}$/);
    const missing = cov.missingPrecinct.map((j) => j.postal).sort();
    assert.ok(missing.includes("AL"));
    assert.ok(missing.includes("AK"));
    assert.ok(missing.includes("LA"));
    assert.ok(missing.includes("VA"));
    assert.ok(!missing.includes("CA"));
    assert.ok(!missing.includes("DC"));
    assert.equal(sealWorkup(cov.workup).sha256, cov.workup.sha256);
  });

  it("treats DC as expected and does not treat Puerto Rico as a missing state", () => {
    const cov = buildCoverage([{ fips: "11" }], { 11: {} });
    assert.ok(cov.expected.some((j) => j.fips === "11" && j.postal === "DC"));
    assert.ok(!cov.expected.some((j) => j.fips === "72"));
    assert.ok(!cov.missingPrecinct.some((j) => j.fips === "72"));
  });
});
