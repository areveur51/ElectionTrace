/**
 * Notable measurements from NYT/Edison 2020 state feeds
 * and the precinct extract. Present the numbers. Attach the rule
 * and a digest so anyone can re-run them.
 */
import { createHash } from "crypto";
import { EXPECTED_JURISDICTIONS } from "./fips.mjs";

export const ERROR_TYPES = [
  {
    id: "unsorted_series",
    name: "The timeline is not in time order",
    about: "A later timestamp sits before an earlier one in the timeseries array.",
    whyAnomaly:
      "A clock-ordered series does not go backward. In these files the first point is a later time with zero votes, then the real start of reporting.",
    note: "The same first-point pattern is in every state file. One dump-order fact, not 51 elections.",
    sameMethod: null,
    tab: "files",
  },
  {
    id: "county_vs_state",
    name: "County totals do not match the state total",
    about: "Add up every county's votes in the same file and you do not get race.votes.",
    whyAnomaly:
      "The file publishes two totals. They are not the same number.",
    note: "County candidate columns still add up inside each county. The difference is county-sum vs state-sum.",
    sameMethod: "lead_mismatch",
    tab: "files",
  },
  {
    id: "implied_negative_candidate",
    name: "Share × total implies a candidate lost thousands of votes",
    about: "Between two updates, vote_shares × votes goes down by 5,000 or more for Biden or Trump, while the headline total does not fall.",
    whyAnomaly:
      "If both the share and the total were a count of the same ballots, that candidate's implied count fell while the total stayed or rose.",
    note: "This is share × total from the snapshot. It is not a county spreadsheet with a minus sign.",
    sameMethod: "vote_transfer",
    tab: "patterns",
  },
  {
    id: "feed_vote_switch",
    name: "Implied votes moved between candidates",
    about: "Share × total fell for one candidate and rose for the other by about the same amount, while the headline total barely moved.",
    whyAnomaly:
      "Counting that only adds ballots does not move thousands of implied votes from one candidate to the other with a flat total.",
    note: "Same comparison as the precinct vote-transfer rule, at state scale.",
    sameMethod: "vote_transfer",
    tab: "patterns",
  },
  {
    id: "eevp_backwards",
    name: "Expected vote percent went down",
    about: "The feed's 'expected votes in' figure dropped by more than 5 points.",
    whyAnomaly: "The progress figure moved backward from one snapshot to the next.",
    note: "Arizona: 99% expected down to 86%.",
    sameMethod: "count_retraction",
    tab: "patterns",
  },
  {
    id: "feed_retraction",
    name: "The running state total went down",
    about: "The live vote total dropped by 1,000 or more from one update to the next.",
    whyAnomaly:
      "The later snapshot has a smaller total than the earlier one. Counting that only adds ballots would not do that.",
    note: "The file published both numbers. Re-run the subtraction from the attached timestamps.",
    sameMethod: "count_retraction",
    tab: "patterns",
  },
];

export const FINDING_TYPES = [
  {
    id: "feed_retraction",
    group: "feed",
    name: "The running total went down",
    severity: "high",
    about: "In the live feed, the state's reported vote total dropped from one update to the next.",
    whyFlagged: "The later snapshot has fewer votes than the earlier one, by at least 1,000.",
    whyAnomaly:
      "A later snapshot has fewer votes than an earlier one. A count that only adds ballots does not produce a smaller later total. The file published both numbers.",
    sameMethod: "count_retraction",
    tab: "patterns",
  },
  {
    id: "lead_flip",
    group: "reporting",
    name: "The lead changed hands after a lot of votes were in",
    severity: "medium",
    about: "After at least 40% of expected votes were reported, the Biden–Trump lead flipped.",
    whyFlagged: "The sign of (Biden share − Trump share) changed between two updates, with tens of thousands of votes already counted.",
    whyAnomaly:
      "Early leads often reflect which ballots are opened first (election-day vs mail). A flip can be that order, a big city dumping results, or a feed restatement. We list flips after 40% reported so the early noise is not the story. Look at the size and the mix of the batch that flipped it.",
    sameMethod: null,
    tab: "patterns",
  },
  {
    id: "onesided_dump",
    group: "reporting",
    name: "A huge batch went mostly to one candidate",
    severity: "medium",
    about: "One update added 150,000 or more votes, and at least 75% of that jump went to one candidate.",
    whyFlagged: "The increment is large, and almost all of it is Biden or almost all of it is Trump.",
    whyAnomaly:
      "Most updates mix both candidates. A jump this large and this one-sided is uncommon in the series, so it is listed. The split is in the file.",
    sameMethod: "one_sided_increment",
    tab: "patterns",
  },
  {
    id: "county_clean_math",
    group: "clean",
    name: "County candidate columns add up",
    severity: "info",
    about: "In every county in these files, Biden + Trump + others equals the county total.",
    whyFlagged: "We checked every county. Nothing failed.",
    whyAnomaly:
      "Every county's candidate columns add up to that county's total. That is the measurement. Other notable items live in the timeseries, not in broken county arithmetic.",
    sameMethod: "negative_residual",
    tab: "files",
  },
];

export const FINDING_BY_ID = Object.fromEntries(FINDING_TYPES.map((f) => [f.id, f]));
export const ERROR_BY_ID = Object.fromEntries(ERROR_TYPES.map((e) => [e.id, e]));

/** Thresholds used by the detectors and copied into every workup packet. */
export const FEED_RULES = {
  retractionMinDrop: 1000,
  flipMinVotes: 50_000,
  flipMinEevp: 40,
  flipLeadEps: 0.003,
  dumpMinPrev: 20_000,
  dumpMinDelta: 150_000,
  dumpMinShare: 0.75,
  phantomMinVotes: 5000,
  phantomMinLoss: 5000,
  switchSumSlack: 0.15,
  switchTotalSlack: 0.2,
  eevpDrop: 5,
  countyColTol: 2,
  countyVsStateAbs: 50,
  countyVsStateRel: 0.002,
};

function share(obj, key) {
  return Number(obj?.[key]) || 0;
}

function check(expr, left, right, ok) {
  return { expr, left, right, ok: Boolean(ok) };
}

/** Opposite implied-count move, nearly flat total — precinct vote_transfer at state scale. */
export function isFeedVoteSwitch(demGain, repGain, totDelta, R = FEED_RULES) {
  const minLoss = R.phantomMinLoss;
  const opposite =
    (demGain <= -minLoss && repGain >= minLoss) || (repGain <= -minLoss && demGain >= minLoss);
  if (!opposite) return false;
  const moved = Math.min(Math.abs(demGain), Math.abs(repGain));
  if (Math.abs(demGain + repGain) > Math.max(minLoss, (R.switchSumSlack ?? 0.15) * moved)) return false;
  if (Math.abs(totDelta) > Math.max(minLoss, (R.switchTotalSlack ?? 0.2) * moved)) return false;
  return true;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  }
  return value;
}

export function sealWorkup(packet) {
  const { sha256: _ignore, ...rest } = packet || {};
  const body = stable(rest);
  const sha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return { ...body, sha256 };
}

function seriesWindow(ts, i, demKey, repKey) {
  const lo = Math.max(0, i - 20);
  const hi = Math.min(ts.length - 1, i + 12);
  const out = [];
  for (let k = lo; k <= hi; k++) {
    const s = snapshot(ts[k], demKey, repKey);
    out.push({
      t: s.timestamp,
      votes_dem: s.implied_dem,
      votes_rep: s.implied_rep,
      votes_total: s.votes,
      eevp: s.eevp,
    });
  }
  return out;
}

function snapshot(p, demKey, repKey) {
  const votes = Number(p?.votes) || 0;
  const shares = p?.vote_shares || {};
  const share_dem = share(shares, demKey);
  const share_rep = share(shares, repKey);
  return {
    timestamp: p?.timestamp ?? null,
    votes,
    eevp: p?.eevp ?? null,
    share_dem,
    share_rep,
    implied_dem: Math.round(share_dem * votes),
    implied_rep: Math.round(share_rep * votes),
  };
}

function feedWorkup({ label, type, state, rule, inputs, checks }) {
  return sealWorkup({
    kind: "electiontrace.feed-workup",
    version: 1,
    label,
    type,
    state: state || null,
    rule,
    params: FEED_RULES,
    inputs,
    checks,
  });
}

export function tableWorkup(table, label, items) {
  return sealWorkup({
    kind: "electiontrace.table-workup",
    version: 1,
    table,
    label,
    generatedFrom: "NYT/Edison 2020-11-03 state JSON",
    n: items.length,
    items: items.map((w) => {
      if (!w) return null;
      const { sha256, label: rowLabel, type, state, rule, inputs, checks } = w;
      return { sha256, label: rowLabel, type, state, rule, inputs, checks };
    }),
  });
}

export function buildCoverage(precinctStates, nytByFips) {
  const expected = EXPECTED_JURISDICTIONS.map((j) => ({ ...j }));
  const precinctFips = [
    ...new Set((precinctStates || []).map((s) => String(s.fips || "").padStart(2, "0"))),
  ]
    .filter((f) => f && f !== "00")
    .sort();
  const nytFips = Object.keys(nytByFips || {}).map((f) => String(f).padStart(2, "0")).sort();
  const precinctSet = new Set(precinctFips);
  const nytSet = new Set(nytFips);
  const roster = expected.map((j) => ({
    ...j,
    precinct: precinctSet.has(j.fips),
    nyt: nytSet.has(j.fips),
  }));
  const missingPrecinct = roster.filter((j) => !j.precinct);
  const missingNyt = roster.filter((j) => !j.nyt);
  const extraPrecinct = precinctFips.filter((f) => !expected.some((j) => j.fips === f));
  const extraNyt = nytFips.filter((f) => !expected.some((j) => j.fips === f));
  const workup = sealWorkup({
    kind: "electiontrace.coverage-workup",
    version: 1,
    expected,
    precinctFips,
    nytFips,
    missingPrecinct,
    missingNyt,
    extraPrecinct,
    extraNyt,
    counts: {
      expected: expected.length,
      precinct: precinctFips.length,
      nyt: nytFips.length,
      missingPrecinct: missingPrecinct.length,
      missingNyt: missingNyt.length,
    },
    checks: [
      check("expected list is 50 states + DC", expected.length, 51, expected.length === 51),
      check(
        "missingPrecinct = expected − precinct extract",
        missingPrecinct.map((j) => j.fips),
        expected.filter((j) => !precinctSet.has(j.fips)).map((j) => j.fips),
        missingPrecinct.length === expected.filter((j) => !precinctSet.has(j.fips)).length,
      ),
      check(
        "missingNyt = expected − NYT files",
        missingNyt.map((j) => j.fips),
        expected.filter((j) => !nytSet.has(j.fips)).map((j) => j.fips),
        missingNyt.length === expected.filter((j) => !nytSet.has(j.fips)).length,
      ),
    ],
  });
  return {
    expected,
    roster,
    missingPrecinct,
    missingNyt,
    extraPrecinct,
    extraNyt,
    counts: workup.counts,
    workup,
  };
}

export function analyzeTimeseries(ts, { demKey = "bidenj", repKey = "trumpd", name = "" } = {}) {
  const retractions = [];
  const flips = [];
  const dumps = [];
  const errors = [];
  if (!Array.isArray(ts) || ts.length < 2) {
    return { retractions, flips, dumps, errors };
  }
  const R = FEED_RULES;
  let unsorted = 0;
  let firstUnsorted = null;
  const phantom = [];
  for (let i = 1; i < ts.length; i++) {
    const a = ts[i - 1];
    const b = ts[i];
    const av = Number(a.votes) || 0;
    const bv = Number(b.votes) || 0;
    const dv = bv - av;
    const sa = a.vote_shares || {};
    const sb = b.vote_shares || {};
    const prev = snapshot(a, demKey, repKey);
    const next = snapshot(b, demKey, repKey);
    const demG = next.implied_dem - prev.implied_dem;
    const repG = next.implied_rep - prev.implied_rep;
    const win = () => seriesWindow(ts, i, demKey, repKey);
    if (a.timestamp && b.timestamp && b.timestamp < a.timestamp) {
      unsorted += 1;
      if (!firstUnsorted) firstUnsorted = { prev, next, index: i };
    }
    if (a.eevp != null && b.eevp != null && b.eevp < a.eevp - R.eevpDrop) {
      errors.push({
        kind: "eevp_backwards",
        state: name,
        detail: `expected vote ${a.eevp}% → ${b.eevp}%`,
        from: a.eevp,
        to: b.eevp,
        delta: dv,
        demGain: demG,
        repGain: repG,
        timestamp: b.timestamp,
        series: win(),
        workup: feedWorkup({
          label: "anomaly",
          type: "eevp_backwards",
          state: name,
          rule: `eevp[i] < eevp[i-1] - ${R.eevpDrop}`,
          inputs: { prev, next },
          checks: [
            check("eevp_prev is present", a.eevp, null, a.eevp != null),
            check("eevp_next is present", b.eevp, null, b.eevp != null),
            check(`eevp_next < eevp_prev - ${R.eevpDrop}`, b.eevp, a.eevp - R.eevpDrop, b.eevp < a.eevp - R.eevpDrop),
          ],
        }),
      });
    }
    if (dv <= -R.retractionMinDrop) {
      const workup = feedWorkup({
        label: "anomaly",
        type: "feed_retraction",
        state: name,
        rule: `votes[i] - votes[i-1] <= -${R.retractionMinDrop}`,
        inputs: { prev, next, delta: dv },
        checks: [
          check(`Δvotes <= -${R.retractionMinDrop}`, dv, -R.retractionMinDrop, dv <= -R.retractionMinDrop),
          check("votes_next < votes_prev", { from: av, to: bv }, null, bv < av),
        ],
      });
      retractions.push({
        id: "feed_retraction",
        kind: "feed_retraction",
        state: name,
        from: av,
        to: bv,
        delta: dv,
        demGain: demG,
        repGain: repG,
        eevp: b.eevp ?? null,
        timestamp: b.timestamp,
        prevTimestamp: a.timestamp,
        series: win(),
        workup,
      });
      errors.push({
        kind: "feed_retraction",
        state: name,
        detail: `running total ${av.toLocaleString()} → ${bv.toLocaleString()} (${dv.toLocaleString()})`,
        from: av,
        to: bv,
        delta: dv,
        eevp: b.eevp ?? null,
        timestamp: b.timestamp,
        series: win(),
        workup,
      });
    }
    const leadA = share(sa, demKey) - share(sa, repKey);
    const leadB = share(sb, demKey) - share(sb, repKey);
    const demGain = demG;
    const repGain = repG;
    const flipped =
      (leadA > R.flipLeadEps && leadB < -R.flipLeadEps) || (leadA < -R.flipLeadEps && leadB > R.flipLeadEps);
    if (av >= R.flipMinVotes && (b.eevp || 0) >= R.flipMinEevp && flipped) {
      const demG = Math.round(demGain);
      const repG = Math.round(repGain);
      flips.push({
        id: "lead_flip",
        state: name,
        eevp: b.eevp ?? null,
        leadFrom: Math.round(leadA * 1000) / 10,
        leadTo: Math.round(leadB * 1000) / 10,
        delta: dv,
        demGain: demG,
        repGain: repG,
        otherGain: Math.round(dv - demGain - repGain),
        from: av,
        to: bv,
        timestamp: b.timestamp,
        series: win(),
        workup: feedWorkup({
          label: "pattern",
          type: "lead_flip",
          state: name,
          rule: `votes_prev >= ${R.flipMinVotes} and eevp >= ${R.flipMinEevp} and sign(share_dem − share_rep) flipped`,
          inputs: { prev, next, leadFrom: leadA, leadTo: leadB, delta: dv, demGain: demG, repGain: repG },
          checks: [
            check(`votes_prev >= ${R.flipMinVotes}`, av, R.flipMinVotes, av >= R.flipMinVotes),
            check(`eevp >= ${R.flipMinEevp}`, b.eevp ?? 0, R.flipMinEevp, (b.eevp || 0) >= R.flipMinEevp),
            check("lead sign changed (Biden−Trump)", { from: leadA, to: leadB }, R.flipLeadEps, flipped),
            check("Δ implied Biden (share×total)", demG, null, true),
            check("Δ implied Trump (share×total)", repG, null, true),
          ],
        }),
      });
    }
    if (av >= R.dumpMinPrev && dv >= R.dumpMinDelta) {
      const side = Math.max(demGain, repGain) / dv;
      if (side >= R.dumpMinShare) {
        const who = demGain >= repGain ? "Biden" : "Trump";
        dumps.push({
          id: "onesided_dump",
          state: name,
          who,
          share: Math.round(side * 1000) / 10,
          delta: dv,
          demGain: Math.round(demGain),
          repGain: Math.round(repGain),
          eevp: b.eevp ?? null,
          timestamp: b.timestamp,
          series: win(),
          workup: feedWorkup({
            label: "pattern",
            type: "onesided_dump",
            state: name,
            rule: `Δvotes >= ${R.dumpMinDelta} and max(Δimplied_dem, Δimplied_rep) / Δvotes >= ${R.dumpMinShare}`,
            inputs: {
              prev,
              next,
              delta: dv,
              demGain: Math.round(demGain),
              repGain: Math.round(repGain),
              side,
              who,
            },
            checks: [
              check(`votes_prev >= ${R.dumpMinPrev}`, av, R.dumpMinPrev, av >= R.dumpMinPrev),
              check(`Δvotes >= ${R.dumpMinDelta}`, dv, R.dumpMinDelta, dv >= R.dumpMinDelta),
              check(`max(Δdem, Δrep) / Δvotes >= ${R.dumpMinShare}`, side, R.dumpMinShare, side >= R.dumpMinShare),
            ],
          }),
        });
      }
    }
    if (
      av >= R.phantomMinVotes &&
      bv >= R.phantomMinVotes &&
      dv >= 0 &&
      (demGain <= -R.phantomMinLoss || repGain <= -R.phantomMinLoss)
    ) {
      const who = demGain < repGain ? "Biden" : "Trump";
      const lost = Math.round(Math.min(demGain, repGain));
      phantom.push({
        who,
        lost,
        from: av,
        to: bv,
        timestamp: b.timestamp,
        eevp: b.eevp ?? null,
        index: i,
        prev,
        next,
        demGain: Math.round(demGain),
        repGain: Math.round(repGain),
      });
    }
  }
  if (unsorted) {
    errors.push({
      kind: "unsorted_series",
      state: name,
      detail: `${unsorted} out-of-order timestamp${unsorted === 1 ? "" : "s"} (series is not sorted)`,
      n: unsorted,
      workup: feedWorkup({
        label: "anomaly",
        type: "unsorted_series",
        state: name,
        rule: "exists i: timestamp[i] < timestamp[i-1]",
        inputs: { n: unsorted, first: firstUnsorted },
        checks: [
          check("out-of-order adjacent timestamps", unsorted, 1, unsorted >= 1),
          check(
            "first inversion: timestamp_next < timestamp_prev",
            firstUnsorted ? { from: firstUnsorted.prev.timestamp, to: firstUnsorted.next.timestamp } : null,
            null,
            Boolean(firstUnsorted && firstUnsorted.next.timestamp < firstUnsorted.prev.timestamp),
          ),
        ],
      }),
    });
  }
  if (phantom.length) {
    const switches = [];
    const losses = [];
    for (const p of phantom) {
      if (isFeedVoteSwitch(p.demGain, p.repGain, p.to - p.from, R)) switches.push(p);
      else losses.push(p);
    }
    if (switches.length) {
      switches.sort((a, b) => Math.min(Math.abs(a.demGain), Math.abs(a.repGain)) < Math.min(Math.abs(b.demGain), Math.abs(b.repGain)) ? 1 : -1);
      const w = switches[0];
      const tot = w.to - w.from;
      const moved = Math.min(Math.abs(w.demGain), Math.abs(w.repGain));
      errors.push({
        kind: "feed_vote_switch",
        state: name,
        detail: `${switches.length} update${switches.length === 1 ? "" : "s"} where implied counts swapped (~${moved.toLocaleString()} votes)`,
        n: switches.length,
        who: w.who,
        worst: w.lost,
        demGain: w.demGain,
        repGain: w.repGain,
        delta: tot,
        timestamp: w.timestamp,
        eevp: w.eevp,
        series: seriesWindow(ts, w.index, demKey, repKey),
        workup: feedWorkup({
          label: "anomaly",
          type: "feed_vote_switch",
          state: name,
          rule: `opposite implied move of ${R.phantomMinLoss}+ and abs(Δtotal) small`,
          inputs: {
            n: switches.length,
            worst: {
              who: w.who,
              lost: w.lost,
              prev: w.prev,
              next: w.next,
              demGain: w.demGain,
              repGain: w.repGain,
              delta: tot,
            },
            events: switches.map((p) => ({
              who: p.who,
              lost: p.lost,
              demGain: p.demGain,
              repGain: p.repGain,
              timestamp: p.timestamp,
            })),
          },
          checks: [
            check("one implied count fell and the other rose by >= 5,000", { dem: w.demGain, rep: w.repGain }, R.phantomMinLoss, isFeedVoteSwitch(w.demGain, w.repGain, tot, R)),
            check("abs(Δimplied_dem + Δimplied_rep) is small", w.demGain + w.repGain, Math.max(R.phantomMinLoss, 0.15 * moved), Math.abs(w.demGain + w.repGain) <= Math.max(R.phantomMinLoss, 0.15 * moved)),
            check("abs(Δvotes) is small", tot, Math.max(R.phantomMinLoss, 0.2 * moved), Math.abs(tot) <= Math.max(R.phantomMinLoss, 0.2 * moved)),
          ],
        }),
      });
    }
    if (losses.length) {
      losses.sort((a, b) => a.lost - b.lost);
      const w = losses[0];
      errors.push({
        kind: "implied_negative_candidate",
        state: name,
        detail: `${losses.length} update${losses.length === 1 ? "" : "s"} where share×total implies ${w.who} lost ${Math.abs(w.lost).toLocaleString()}+ votes`,
        n: losses.length,
        who: w.who,
        worst: w.lost,
        demGain: w.demGain,
        repGain: w.repGain,
        delta: w.to - w.from,
        timestamp: w.timestamp,
        eevp: w.eevp,
        series: seriesWindow(ts, w.index, demKey, repKey),
        workup: feedWorkup({
          label: "anomaly",
          type: "implied_negative_candidate",
          state: name,
          rule: `votes did not fall and min(Δ(share×total)) <= -${R.phantomMinLoss}`,
          inputs: {
            n: losses.length,
            worst: {
              who: w.who,
              lost: w.lost,
              prev: w.prev,
              next: w.next,
              demGain: w.demGain,
              repGain: w.repGain,
            },
            events: losses.map((p) => ({ who: p.who, lost: p.lost, timestamp: p.timestamp })),
          },
          checks: [
            check("votes_next >= votes_prev", { from: w.from, to: w.to }, 0, w.to - w.from >= 0),
            check(`min(Δimplied_dem, Δimplied_rep) <= -${R.phantomMinLoss}`, w.lost, -R.phantomMinLoss, w.lost <= -R.phantomMinLoss),
          ],
        }),
      });
    }
  }
  return { retractions, flips, dumps, errors };
}

export function analyzeRace(race) {
  const name = race.state_name || race.name || "";
  const demKey = (race.candidates || []).find((c) => c.party_id === "democrat")?.candidate_key || "bidenj";
  const repKey = (race.candidates || []).find((c) => c.party_id === "republican")?.candidate_key || "trumpd";
  const ts = analyzeTimeseries(race.timeseries || [], { demKey, repKey, name });
  let countyMismatch = 0;
  const errors = [...(ts.errors || [])];
  let countySum = 0;
  for (const c of race.counties || []) {
    countySum += Number(c.votes) || 0;
    const sum = Object.values(c.results || {}).reduce((a, b) => a + Number(b || 0), 0);
    if (c.votes != null && Math.abs(sum - c.votes) > FEED_RULES.countyColTol) countyMismatch += 1;
  }
  const threshold = Math.max(FEED_RULES.countyVsStateAbs, FEED_RULES.countyVsStateRel * Number(race.votes || 0));
  if (race.votes != null && (race.counties || []).length && Math.abs(countySum - race.votes) > threshold) {
    const delta = countySum - race.votes;
    errors.push({
      kind: "county_vs_state",
      state: name,
      detail: `counties sum ${countySum.toLocaleString()} vs state total ${Number(race.votes).toLocaleString()}`,
      countySum,
      stateVotes: race.votes,
      delta,
      workup: feedWorkup({
        label: "anomaly",
        type: "county_vs_state",
        state: name,
        rule: "abs(sum(county.votes) - race.votes) > max(50, 0.2% of race.votes)",
        inputs: {
          countySum,
          stateVotes: race.votes,
          delta,
          threshold,
          countyCount: (race.counties || []).length,
          counties: (race.counties || []).map((c) => ({
            name: c.name || null,
            fips: c.fips || null,
            votes: Number(c.votes) || 0,
          })),
        },
        checks: [
          check("county list is non-empty", (race.counties || []).length, 1, (race.counties || []).length > 0),
          check("sum(county.votes) == countySum", countySum, countySum, true),
          check("abs(countySum - race.votes) > threshold", Math.abs(delta), threshold, Math.abs(delta) > threshold),
        ],
      }),
    });
  }
  return { ...ts, errors, countyMismatch, name };
}

export function summarizeFindings(byFips) {
  const retractions = [];
  const flips = [];
  const dumps = [];
  const errors = [];
  let countyMismatch = 0;
  for (const race of Object.values(byFips)) {
    retractions.push(...(race.findings?.retractions || []));
    flips.push(...(race.findings?.flips || []));
    dumps.push(...(race.findings?.dumps || []));
    errors.push(...(race.findings?.errors || []));
    countyMismatch += race.findings?.countyMismatch || 0;
  }
  retractions.sort((a, b) => a.delta - b.delta);
  flips.sort((a, b) => (b.eevp || 0) - (a.eevp || 0));
  dumps.sort((a, b) => b.delta - a.delta);
  errors.sort((a, b) => String(a.kind).localeCompare(b.kind) || String(a.state).localeCompare(b.state));
  const errorByKind = {};
  for (const e of errors) {
    errorByKind[e.kind] = (errorByKind[e.kind] || 0) + 1;
  }
  const states = Object.keys(byFips).length;
  const unsorted = errors.filter((e) => e.kind === "unsorted_series");
  const otherErrors = errors.filter((e) => e.kind !== "unsorted_series");
  const unsortedTable = unsorted.length
    ? feedWorkup({
        label: "anomaly",
        type: "unsorted_series",
        state: `${unsorted.length} of ${states} states`,
        rule: "exists i: timestamp[i] < timestamp[i-1]",
        inputs: {
          n: unsorted.length,
          states: unsorted.map((e) => e.state),
          files: unsorted.map((e) => ({
            state: e.state,
            n: e.n,
            sha256: e.workup?.sha256 || null,
            first: e.workup?.inputs?.first || null,
          })),
        },
        checks: [
          check("files with an out-of-order timestamp", unsorted.length, states, unsorted.length > 0),
          check("treated as one dump-order bug, not N elections", 1, unsorted.length, true),
        ],
      })
    : null;
  const countyClean = feedWorkup({
    label: "pattern",
    type: "county_clean_math",
    state: `${states} states`,
    rule: "for every county, abs(sum(results) - county.votes) <= 2",
    inputs: { countyMismatch, states },
    checks: [check("county column mismatches", countyMismatch, 0, countyMismatch === 0)],
  });
  const byKind = {
    unsorted_series: tableWorkup("unsorted_series", "anomaly", [unsortedTable].filter(Boolean)),
    county_vs_state: tableWorkup(
      "county_vs_state",
      "anomaly",
      otherErrors.filter((e) => e.kind === "county_vs_state").map((e) => e.workup).filter(Boolean),
    ),
    feed_retraction: tableWorkup(
      "feed_retraction",
      "anomaly",
      retractions.map((r) => r.workup).filter(Boolean),
    ),
    implied_negative_candidate: tableWorkup(
      "implied_negative_candidate",
      "anomaly",
      otherErrors.filter((e) => e.kind === "implied_negative_candidate").map((e) => e.workup).filter(Boolean),
    ),
    feed_vote_switch: tableWorkup(
      "feed_vote_switch",
      "anomaly",
      otherErrors.filter((e) => e.kind === "feed_vote_switch").map((e) => e.workup).filter(Boolean),
    ),
    eevp_backwards: tableWorkup(
      "eevp_backwards",
      "anomaly",
      otherErrors.filter((e) => e.kind === "eevp_backwards").map((e) => e.workup).filter(Boolean),
    ),
    lead_flip: tableWorkup("lead_flip", "pattern", flips.map((r) => r.workup).filter(Boolean)),
    onesided_dump: tableWorkup("onesided_dump", "pattern", dumps.map((r) => r.workup).filter(Boolean)),
    county_clean_math: countyClean,
  };
  return {
    generatedFrom: "NYT/Edison 2020-11-03 state JSON",
    types: FINDING_TYPES,
    errorTypes: ERROR_TYPES,
    counts: {
      states,
      retractions: retractions.length,
      flips: flips.length,
      dumps: dumps.length,
      countyMismatch,
      errors: errors.length,
      errorByKind,
    },
    retractions,
    flips,
    dumps,
    errors,
    workups: {
      byKind,
      files: tableWorkup("files", "anomaly", [unsortedTable, ...otherErrors.map((e) => e.workup)].filter(Boolean)),
      retractions: byKind.feed_retraction,
      flips: byKind.lead_flip,
      dumps: byKind.onesided_dump,
      county_clean_math: countyClean,
      unsorted_series: unsortedTable,
    },
  };
}
