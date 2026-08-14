/**
 * National anomaly methods.
 *
 * Every detector is a pure function of precinct fields + the *same*
 * per-state distribution stats. No state-specific special cases.
 * Thresholds are documented here and returned by GET /api/methods.
 *
 * Snapshot rules run on a single report. Temporal rules also need a
 * prior report on the row (votes_*_prev or a history[] array that the
 * scanner flattened). Missing priors simply skip those flags.
 */

export const METHODS = [
  {
    id: "zero_votes",
    name: "Zero reported votes",
    group: "completeness",
    color: "#8b97b0",
    summary:
      "Precinct geometry exists but votes_total is 0. Missing returns, unpopulated land, or a join failure.",
    rule: "votes_total == 0",
    plain: {
      about: "This precinct is on the map, but it reported zero votes.",
      whyFlagged: "The total vote count is exactly 0, even though the precinct exists as a place.",
      whyAnomaly:
        "Most mapped precincts that publish results have at least one ballot. A zero total means empty geometry, a missing return, or a failed join between the map and the results file.",
    },
  },
  {
    id: "negative_residual",
    name: "Impossible vote arithmetic",
    group: "integrity",
    color: "#e23b32",
    summary:
      "Democratic + Republican votes exceed the reported total. The row cannot be internally consistent.",
    rule: "(votes_dem + votes_rep) - votes_total > 0.5",
    plain: {
      about: "The numbers on this row cannot add up.",
      whyFlagged:
        "If you add the Democratic votes and the Republican votes, you get more than the reported total. That is impossible if every ballot is counted once.",
      whyAnomaly:
        "A finished count should be internally consistent. When the parts are larger than the whole, two reports were mixed or a column was copied wrong. The same add-up is run on every county in the night files: candidate columns match the county total (0 mismatches). The night-file disagreement is a different comparison — county-sum versus the state total.",
    },
    sameAs: [{ id: "county_clean_math", tab: "files" }],
  },
  {
    id: "other_share",
    name: "High non-major-party share",
    group: "integrity",
    color: "#b26bff",
    summary:
      "A large share of ballots is neither Dem nor Rep (third party, write-in, undervote, or a coding error).",
    rule: "(votes_total - votes_dem - votes_rep) / votes_total >= 0.25 and votes_total >= 50",
    plain: {
      about: "A large share of the ballots is not listed as Democrat or Republican.",
      whyFlagged:
        "At least a quarter of the total is leftover after subtracting the two major-party counts, and there are enough ballots for that leftover to matter.",
      whyAnomaly:
        "Third-party votes and write-ins almost never take a quarter of a precinct of 50 or more ballots. A leftover that large is undervotes dumped into one bucket, a coding leftover, or a column that was never filled.",
    },
    params: { minShare: 0.25, minVotes: 50 },
  },
  {
    id: "unanimous",
    name: "Unanimous precinct",
    group: "partisan",
    color: "#f4c430",
    summary:
      "Every counted major-party vote is one party. Rare at 50 or more ballots — either the precinct is fully one-sided or the other party's count is missing.",
    rule: "votes_total >= 50 and (votes_dem == votes_total or votes_rep == votes_total)",
    plain: {
      about: "Every counted vote in this precinct went to one major party.",
      whyFlagged:
        "There are at least 50 votes, and they are all Democratic or all Republican. Nobody in the file voted the other way.",
      whyAnomaly:
        "At 50 or more ballots, a 100–0 split is rare nationwide. Either the precinct is genuinely one-sided, or the other party's count was dropped or never recorded.",
    },
    params: { minVotes: 50 },
  },
  {
    id: "near_unanimous",
    name: "Near-unanimous precinct",
    group: "partisan",
    color: "#ff8a3c",
    summary:
      "One party leads by 95 points or more with a meaningful vote count. Possible, but a national tail event.",
    rule: "abs(pct_dem_lead) >= 95 and votes_total >= 100",
    plain: {
      about: "One party almost swept this precinct.",
      whyFlagged:
        "There are at least 100 votes, and the lead is 95 points or more. That is a near-shutout, not a close race.",
      whyAnomaly:
        "Landslides happen in some neighborhoods. A 95-point gap with a hundred or more ballots is still in the national tail — either a real shutout or a geography that does not match the file.",
    },
    params: { minAbsLead: 95, minVotes: 100 },
  },
  {
    id: "density_spike",
    name: "Vote-density spike",
    group: "spatial",
    color: "#ff3d88",
    summary:
      "Votes per km² sit in the extreme tail of that state and far above the state median. Tiny sliver geometries or stacked ballots both produce this.",
    rule: "votes_per_sqkm >= state P99.5 and votes_per_sqkm >= 8 × state median and votes_total >= 20",
    plain: {
      about: "This precinct packed far more votes into a small area than is typical for its state.",
      whyFlagged:
        "Votes per square kilometer are in the top half-percent for that state, and at least eight times the state’s usual (median) density.",
      whyAnomaly:
        "A downtown tower can be dense. The same reading also appears when geometry is a sliver, the area is wrong, or ballots are stacked onto the wrong shape. The comparison is only to this state's own density distribution.",
    },
    params: { percentile: 0.995, medianMult: 8, minVotes: 20 },
  },
  {
    id: "mega_precinct",
    name: "Outlier vote total",
    group: "spatial",
    color: "#2ad4ff",
    summary:
      "The raw vote total is extreme for its state. Sometimes a real mega-precinct; sometimes several units collapsed into one GEOID.",
    rule: "votes_total >= state P99.5 and votes_total >= 5 × state median and votes_total >= 200",
    plain: {
      about: "This precinct’s raw vote total is huge compared with others in the same state.",
      whyFlagged:
        "The total is in the top half-percent for the state, at least five times that state’s usual precinct size, and at least 200 votes.",
      whyAnomaly:
        "Some states have giant vote centers. The same tail also appears when several precincts are merged into one GEOID. Either way the total is an outlier for that state.",
    },
    params: { percentile: 0.995, medianMult: 5, minVotes: 200 },
  },
  {
    id: "non_integer",
    name: "Non-integer vote count",
    group: "integrity",
    color: "#86efac",
    summary:
      "Ballots are whole items. A fractional Dem, Rep, or total is a join error, a weighted estimate stored as a count, or a corrupted field.",
    rule: "votes_dem, votes_rep, or votes_total is finite and not an integer",
    plain: {
      about: "Someone recorded a fraction of a ballot.",
      whyFlagged:
        "The Democratic count, the Republican count, or the total is not a whole number — for example 100.5 votes.",
      whyAnomaly:
        "You cannot cast half a ballot. Fractions usually mean a spreadsheet formula, a weighted estimate saved as a count, or a damaged field. That is a bookkeeping anomaly.",
    },
  },
  {
    id: "negative_votes",
    name: "Negative vote count",
    group: "integrity",
    color: "#f43f5e",
    summary:
      "A candidate or total is below zero. That cannot be a completed canvass; it is almost always a sign-flip or a correction written into the wrong column.",
    rule: "votes_dem < 0 or votes_rep < 0 or votes_total < 0",
    plain: {
      about: "A vote count went below zero.",
      whyFlagged: "The Democratic count, the Republican count, or the total is a negative number.",
      whyAnomaly:
        "A finished canvass cannot owe ballots. Negatives almost always mean a minus sign in the wrong place or a correction typed into the wrong column. The row cannot be a final result as written.",
    },
  },
  {
    id: "lead_mismatch",
    name: "Lead does not match the counts",
    group: "integrity",
    color: "#e879f9",
    summary:
      "pct_dem_lead disagrees with (votes_dem − votes_rep) / votes_total. The published margin and the raw columns are not the same report.",
    rule: "abs(pct_dem_lead − 100 × (votes_dem − votes_rep) / votes_total) > 1 and votes_total >= 10",
    plain: {
      about: "The published margin does not match the raw vote counts.",
      whyFlagged:
        "If you compute the lead from Democrat minus Republican, divided by the total, you do not get the lead stored on the row (off by more than one point).",
      whyAnomaly:
        "Those two fields should describe the same race. When they disagree, two versions were stored side by side. The night files have the same kind of split: add up county.votes and you do not get race.votes in eight states.",
    },
    params: { maxAbsDiff: 1, minVotes: 10 },
    sameAs: [{ id: "county_vs_state", tab: "files" }],
  },
  {
    id: "repeating_digits",
    name: "Repeating-digit tally",
    group: "pattern",
    color: "#f472b6",
    summary:
      "A count contains four or more identical digits in a row (1111, 2222, 0000). Uncommon as a finished return; also the shape of a placeholder or guessed tally.",
    rule: "integer form of votes_dem, votes_rep, or votes_total matches /(\\d)\\1{3,}/",
    plain: {
      about: "A vote total looks like a repeated digit, such as 1111 or 2222.",
      whyFlagged:
        "The Democrat, Republican, or total count contains four identical digits in a row.",
      whyAnomaly:
        "Real precincts can land on 1111 by chance. Repeating digits are also what people type as placeholders. Four identical digits in a row is uncommon as a finished return.",
    },
    params: { minRun: 4 },
  },
  {
    id: "round_block",
    name: "Round-number block",
    group: "pattern",
    color: "#a3e635",
    summary:
      "Dem, Rep, and total are all multiples of 100 on a large precinct. Possible, but a common fingerprint of rounded or invented tallies.",
    rule: "votes_total >= 400 and votes_dem, votes_rep, votes_total are all multiples of 100",
    plain: {
      about: "The Democrat, Republican, and total counts are all neat hundreds.",
      whyFlagged:
        "The precinct has at least 400 votes, and every one of those three numbers is a multiple of 100 — like 300, 500, and 800.",
      whyAnomaly:
        "Live precinct counts are usually messy. Three multiples of 100 on a 400+ precinct is the fingerprint of rounded or invented tallies.",
    },
    params: { minTotal: 400, multiple: 100 },
  },
  {
    id: "duplicate_tally",
    name: "Duplicated county tally",
    group: "pattern",
    color: "#818cf8",
    summary:
      "The exact (Dem, Rep, total) triple appears on three or more precincts in the same county with a meaningful total. Copy-paste, a collapsed unit, or a repeated batch.",
    rule: "same (votes_dem, votes_rep, votes_total) on >= 3 precincts in one county and votes_total >= 50",
    plain: {
      about: "Several precincts in the same county reported the exact same vote counts.",
      whyFlagged:
        "At least three precincts share the same Democrat, Republican, and total numbers, and the total is at least 50.",
      whyAnomaly:
        "Neighboring places rarely finish with identical tallies once the numbers get that large. The same triple often means a row was copied, one batch was reused, or units were collapsed. It can also be a reporting template that was never filled in.",
    },
    params: { minCopies: 3, minVotes: 50 },
  },
  {
    id: "same_candidate_run",
    name: "Same-candidate precinct run",
    group: "pattern",
    color: "#2dd4bf",
    summary:
      "Four or more GEOID-adjacent precincts in one county each give ≥ 98% of their ballots to the same major party. A long one-candidate streak, not a single landslide precinct.",
    rule: ">= 4 consecutive county precincts (sorted by GEOID) with votes_total >= 20 and one party share >= 0.98",
    plain: {
      about: "A string of neighboring precincts in one county almost all voted the same way.",
      whyFlagged:
        "When precincts in the county are lined up by ID, four or more in a row each gave at least 98% of their ballots to the same party.",
      whyAnomaly:
        "One landslide precinct is common. Four IDs in a row that are nearly unanimous is a streak — it can be a real political pocket, or a run of copied or assigned results. The flag marks the streak so it can be checked on a map.",
    },
    params: { minStreak: 4, minVotes: 20, minShare: 0.98 },
  },
  {
    id: "vote_transfer",
    name: "Votes moved between candidates",
    group: "temporal",
    color: "#fb7185",
    summary:
      "Compared with the prior report, one major-party count fell and the other rose by about the same amount while the total barely moved. Needs votes_*_prev or history[].",
    rule: "min(Δdem, Δrep) <= -10 and max(Δdem, Δrep) >= 10 and abs(Δdem + Δrep) is small and abs(Δtotal) is small",
    plain: {
      about: "Between two reports, votes appear to have moved from one candidate to the other.",
      whyFlagged:
        "One major party’s count dropped by 10 or more, the other rose by about the same amount, and the overall total barely changed.",
      whyAnomaly:
        "As more ballots are counted, totals usually go up, not sideways. A swap with a flat total is a change to inspect. The night files show the same shape at state scale: share × total implies a candidate lost 5,000 or more votes while the headline total did not fall.",
    },
    params: { minMoved: 10 },
    sameAs: [
      { id: "feed_vote_switch", tab: "patterns" },
      { id: "implied_negative_candidate", tab: "patterns" },
    ],
  },
  {
    id: "count_retraction",
    name: "Counts went backwards",
    group: "temporal",
    color: "#38bdf8",
    summary:
      "The latest total is lower than the prior report. Counting is supposed to be incremental; a drop is a retraction, a restatement, or a withdrawn batch. Needs a prior report.",
    rule: "votes_total_prev is present and votes_total − votes_total_prev <= -0.5",
    plain: {
      about: "The vote total went down after it had already been reported higher.",
      whyFlagged:
        "Compared with the earlier report for this precinct, the latest total is smaller.",
      whyAnomaly:
        "Counting that only adds ballots does not produce a smaller later total. The night files run the same comparison on the state running total (drop of 1,000 or more) and on expected-in (drop of more than 5 points).",
    },
    params: { minDrop: 0.5 },
    sameAs: [
      { id: "feed_retraction", tab: "patterns" },
      { id: "eevp_backwards", tab: "patterns" },
    ],
  },
  {
    id: "one_sided_increment",
    name: "One-sided batch increment",
    group: "temporal",
    color: "#c084fc",
    summary:
      "A large jump from the prior report went almost entirely to one candidate. That is the snapshot version of “the same candidate, consecutively, in large quantities.” Needs a prior report.",
    rule: "Δtotal >= 150 and max(Δdem, Δrep) / Δtotal >= 0.95",
    plain: {
      about: "A big new batch of votes went almost entirely to one candidate.",
      whyFlagged:
        "Since the last report the total jumped by 150 or more, and at least 95% of that jump belongs to one party.",
      whyAnomaly:
        "Most increments mix both candidates. A jump this large and this one-sided is uncommon, so it is listed. The night files use the same comparison on the state series: 150,000 or more votes in one update, at least 75% to one candidate.",
    },
    params: { minDelta: 150, minShare: 0.95 },
    sameAs: [{ id: "onesided_dump", tab: "patterns" }],
  },
  {
    id: "sequential_digits",
    name: "Sequential-digit tally",
    group: "pattern",
    color: "#22d3ee",
    summary:
      "A count contains four rising or falling digits in a row (1234, 4321). Easy to type, uncommon as a real total.",
    rule: "integer form of votes_dem, votes_rep, or votes_total has 4 consecutive digits that step by +1 or −1",
    plain: {
      about: "A vote count looks like someone typed a run of numbers — 1234 or 4321.",
      whyFlagged:
        "The Democrat, Republican, or total count contains four digits in a row that go straight up or straight down.",
      whyAnomaly:
        "Those runs are easy to type and rare as finished precinct totals. One hit can be chance. Several in a county is a pattern worth asking about.",
    },
    params: { minRun: 4 },
  },
  {
    id: "exact_tie",
    name: "Exact major-party tie",
    group: "pattern",
    color: "#c4b5fd",
    summary:
      "Democrat and Republican counts are identical on a large precinct. Possible, but a coin-flip that exact is uncommon.",
    rule: "votes_dem == votes_rep and votes_dem >= 50 and votes_total >= 100",
    plain: {
      about: "The two major parties finished in a perfect tie here.",
      whyFlagged:
        "Democrat and Republican have the same count, each at least 50, and the precinct has at least 100 votes.",
      whyAnomaly:
        "A true tie happens. An exact 200–200 on a large precinct is still unusual enough to check the return. If the same tie repeats nearby, that is a pattern.",
    },
    params: { minEach: 50, minVotes: 100 },
  },
  {
    id: "ratio_clone",
    name: "Cloned two-party share",
    group: "pattern",
    color: "#fbbf24",
    summary:
      "Four or more precincts in one county share the same two-party percentage (to 0.1%) with a meaningful vote count.",
    rule: "same round(10000 × dem / (dem + rep)) on >= 5 precincts in one county, each dem+rep >= 60, share not a 5% step",
    plain: {
      about: "Several precincts in the same county finished with the same split, down to a tenth of a percent.",
      whyFlagged:
        "At least five precincts share the same Democrat-versus-Republican percentage to a hundredth of a point, and that split is not a neat 5% step like 50.00 or 60.00.",
      whyAnomaly:
        "Neighbors can lean the same way. They rarely land on the exact same 0.1% split. A clone often means a copied row, a shared template, or one result assigned to many IDs. If the pattern repeats, ask why.",
    },
    params: { minCopies: 5, minMajor: 60 },
  },
  {
    id: "total_sequence",
    name: "Arithmetic vote-total run",
    group: "pattern",
    color: "#4ade80",
    summary:
      "Four GEOID-adjacent precincts in a county have totals that rise or fall by the same step (100, 150, 200, 250).",
    rule: ">= 4 consecutive county precincts whose votes_total form an arithmetic progression with |step| >= 10 and each total >= 20",
    plain: {
      about: "Lined up by precinct ID, the vote totals march in even steps.",
      whyFlagged:
        "Four IDs in a row in the same county have totals that go up or down by the same amount each time, at least 10 votes per step.",
      whyAnomaly:
        "Real neighboring totals wobble. A straight 100 / 150 / 200 / 250 ladder looks generated or copied from a worksheet. One run is interesting; several in a county is a pattern.",
    },
    params: { minStreak: 4, minStep: 10, minVotes: 20 },
  },
  {
    id: "last_digit_stack",
    name: "Last-digit stack",
    group: "pattern",
    color: "#67e8f9",
    summary:
      "In one county, one last digit of votes_total shows up far more often than chance (at least 8 precincts and 30% of eligible rows).",
    rule: "count of precincts with votes_total >= 20 sharing last digit d >= max(8, 0.3 × eligible)",
    plain: {
      about: "In this county, vote totals keep ending on the same digit.",
      whyFlagged:
        "Among precincts with at least 20 votes, one last digit — often 0 or 5 — appears on at least eight of them and on at least 30% of that county’s eligible precincts.",
      whyAnomaly:
        "Last digits should be roughly mixed. A pile of totals ending in 0 or 5 can mean rounding, placeholders, or a shared form. When a whole county stacks on one digit, look at how the numbers were entered.",
    },
    params: { minCount: 8, minShare: 0.3, minVotes: 20 },
  },
  {
    id: "zero_cluster",
    name: "Zero-vote county cluster",
    group: "pattern",
    color: "#64748b",
    summary:
      "A county has a pocket of empty precincts: at least 12 zeros and at least 15% of that county’s rows.",
    rule: "zero-vote precincts in county >= 12 and >= 15% of the county",
    plain: {
      about: "A whole pocket of this county reported no votes.",
      whyFlagged:
        "This county has at least 12 precincts with zero votes, and those empties are at least 15% of the county. This precinct is one of them.",
      whyAnomaly:
        "One empty precinct can be vacant land. Eight zeros together can be a missing file, a bad county join, or precincts that were never loaded. The cluster is the reason to look.",
    },
    params: { minZeros: 12, minShare: 0.15 },
  },
  {
    id: "compound_flag",
    name: "Multiple independent flags",
    group: "pattern",
    color: "#e11d48",
    summary:
      "The same precinct trips three or more other detectors. Several independent anomalies on one row is a stronger pattern than any single flag.",
    rule: "count of other flags on the row >= 3",
    plain: {
      about: "This precinct failed several different checks at the same time.",
      whyFlagged:
        "At least three other methods already flagged this row — not three ways of saying the same thing, but a pile-up.",
      whyAnomaly:
        "One odd reading can be a quirk. Three different kinds of odd — arithmetic, size, and pattern, for example — is a stack. If stacks cluster in a county, that is the pattern to explain.",
    },
    params: { minOtherFlags: 3 },
  },
];

export const METHOD_BY_ID = Object.fromEntries(METHODS.map((m) => [m.id, m]));

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function residual(row) {
  const d = num(row.votes_dem);
  const r = num(row.votes_rep);
  const t = num(row.votes_total);
  if (d === null || r === null || t === null) return null;
  return t - d - r;
}

export function isNonIntegerVote(v) {
  const n = num(v);
  if (n === null) return false;
  return Math.abs(n - Math.round(n)) > 1e-6;
}

export function hasRepeatingDigits(v, minRun = 4) {
  const n = num(v);
  if (n === null) return false;
  const s = String(Math.trunc(Math.abs(n)));
  const re = new RegExp(`(\\d)\\1{${minRun - 1},}`);
  return re.test(s);
}

/** Four+ consecutive digits that step by +1 or −1 (1234, 4321). */
export function hasSequentialDigits(v, minRun = 4) {
  const n = num(v);
  if (n === null) return false;
  const s = String(Math.trunc(Math.abs(n)));
  if (s.length < minRun) return false;
  for (let i = 0; i <= s.length - minRun; i++) {
    let up = true;
    let down = true;
    for (let j = 1; j < minRun; j++) {
      const a = Number(s[i + j - 1]);
      const b = Number(s[i + j]);
      if (b !== a + 1) up = false;
      if (b !== a - 1) down = false;
    }
    if (up || down) return true;
  }
  return false;
}

function twoPartyKey(d, r) {
  const maj = d + r;
  if (!Number.isFinite(maj) || maj < 60) return null;
  const hundredths = Math.round((10000 * d) / maj);
  if (hundredths % 500 === 0) return null;
  return String(hundredths);
}

function isArithmeticRun(totals, minStep = 10) {
  if (totals.length < 4) return false;
  const step = totals[1] - totals[0];
  if (!Number.isFinite(step) || Math.abs(step) < minStep) return false;
  for (let i = 2; i < totals.length; i++) {
    if (totals[i] - totals[i - 1] !== step) return false;
  }
  return true;
}

export function computedLead(row) {
  const d = num(row.votes_dem);
  const r = num(row.votes_rep);
  const t = num(row.votes_total);
  if (d === null || r === null || t === null || t === 0) return null;
  return (100 * (d - r)) / t;
}

export function prevSnapshot(row) {
  const d = num(row.votes_dem_prev);
  const r = num(row.votes_rep_prev);
  const t = num(row.votes_total_prev);
  if (d === null && r === null && t === null) return null;
  return { d, r, t };
}

export function voteDelta(row) {
  const prev = prevSnapshot(row);
  if (!prev) return null;
  return {
    d: num(row.votes_dem) === null || prev.d === null ? null : num(row.votes_dem) - prev.d,
    r: num(row.votes_rep) === null || prev.r === null ? null : num(row.votes_rep) - prev.r,
    t: num(row.votes_total) === null || prev.t === null ? null : num(row.votes_total) - prev.t,
  };
}

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

function median(sorted) {
  return quantile(sorted, 0.5);
}

/** First-digit Benford MAD (mean absolute deviation) for a list of positives. */
export function benfordMad(values) {
  const counts = Array(10).fill(0);
  let n = 0;
  for (const v of values) {
    const x = Math.abs(Number(v));
    if (!Number.isFinite(x) || x < 1) continue;
    const d = Number(String(Math.floor(x))[0]);
    if (d >= 1 && d <= 9) {
      counts[d] += 1;
      n += 1;
    }
  }
  if (n < 50) return { n, mad: null, digits: counts.slice(1), expected: null };
  const expected = [];
  let mad = 0;
  for (let d = 1; d <= 9; d++) {
    const exp = Math.log10(1 + 1 / d);
    expected.push(exp);
    mad += Math.abs(counts[d] / n - exp);
  }
  mad /= 9;
  // Nigrini: MAD < 0.006 close, 0.006–0.012 acceptable, 0.012–0.015 marginally, >0.015 nonconform
  let grade = "close";
  if (mad >= 0.015) grade = "nonconform";
  else if (mad >= 0.012) grade = "marginal";
  else if (mad >= 0.006) grade = "acceptable";
  return { n, mad, grade, digits: counts.slice(1), expected };
}

export function buildStateStats(rows) {
  const by = new Map();
  for (const row of rows) {
    const st = row.stateFips || "?";
    if (!by.has(st)) by.set(st, { totals: [], dens: [], name: row.stateName, fips: st });
    const b = by.get(st);
    const t = num(row.votes_total);
    const d = num(row.votes_per_sqkm);
    if (t !== null) b.totals.push(t);
    if (d !== null) b.dens.push(d);
  }
  const out = {};
  for (const [fips, b] of by) {
    b.totals.sort((a, c) => a - c);
    b.dens.sort((a, c) => a - c);
    out[fips] = {
      fips,
      name: b.name,
      n: b.totals.length,
      votesMedian: median(b.totals),
      votesP995: quantile(b.totals, 0.995),
      densMedian: median(b.dens),
      densP995: quantile(b.dens, 0.995),
      benford: benfordMad(b.totals.filter((v) => v >= 1)),
    };
  }
  return out;
}

/**
 * Flag a single precinct. Returns method ids (may be empty).
 * @param {object} row
 * @param {object} stateStat from buildStateStats
 */
export function flagRow(row, stateStat) {
  const flags = [];
  const d = num(row.votes_dem);
  const r = num(row.votes_rep);
  const t = num(row.votes_total);
  const dens = num(row.votes_per_sqkm);
  const lead = num(row.pct_dem_lead);
  const other = residual(row);

  if (t === 0) flags.push("zero_votes");
  if (other !== null && other < -0.5) flags.push("negative_residual");
  if (other !== null && t !== null && t >= 50 && other / t >= 0.25) {
    flags.push("other_share");
  }
  if (t !== null && t >= 50 && d !== null && r !== null && (d === t || r === t)) {
    flags.push("unanimous");
  }
  if (t !== null && t >= 100 && lead !== null && Math.abs(lead) >= 95) {
    flags.push("near_unanimous");
  }
  if (
    stateStat &&
    dens !== null &&
    t !== null &&
    t >= 20 &&
    dens >= stateStat.densP995 &&
    stateStat.densMedian > 0 &&
    dens >= stateStat.densMedian * 8
  ) {
    flags.push("density_spike");
  }
  if (
    stateStat &&
    t !== null &&
    t >= 200 &&
    t >= stateStat.votesP995 &&
    stateStat.votesMedian > 0 &&
    t >= stateStat.votesMedian * 5
  ) {
    flags.push("mega_precinct");
  }
  if (isNonIntegerVote(d) || isNonIntegerVote(r) || isNonIntegerVote(t)) {
    flags.push("non_integer");
  }
  if ((d !== null && d < 0) || (r !== null && r < 0) || (t !== null && t < 0)) {
    flags.push("negative_votes");
  }
  const leadCalc = computedLead(row);
  if (lead !== null && leadCalc !== null && t !== null && t >= 10 && Math.abs(lead - leadCalc) > 1) {
    flags.push("lead_mismatch");
  }
  if (hasRepeatingDigits(d) || hasRepeatingDigits(r) || hasRepeatingDigits(t)) {
    flags.push("repeating_digits");
  }
  if (
    t !== null &&
    d !== null &&
    r !== null &&
    t >= 400 &&
    t % 100 === 0 &&
    d % 100 === 0 &&
    r % 100 === 0
  ) {
    flags.push("round_block");
  }

  const delta = voteDelta(row);
  if (delta && delta.d !== null && delta.r !== null && delta.t !== null) {
    const moved = Math.min(Math.abs(delta.d), Math.abs(delta.r));
    const opposite = (delta.d <= -10 && delta.r >= 10) || (delta.r <= -10 && delta.d >= 10);
    if (
      opposite &&
      Math.abs(delta.d + delta.r) <= Math.max(5, 0.1 * moved) &&
      Math.abs(delta.t) <= Math.max(5, 0.15 * moved)
    ) {
      flags.push("vote_transfer");
    }
    if (delta.t <= -0.5) {
      flags.push("count_retraction");
    }
    if (delta.t >= 150) {
      const side = Math.max(delta.d, delta.r);
      if (side >= 0 && side / delta.t >= 0.95) {
        flags.push("one_sided_increment");
      }
    }
  }
  if (hasSequentialDigits(d) || hasSequentialDigits(r) || hasSequentialDigits(t)) {
    flags.push("sequential_digits");
  }
  if (d !== null && r !== null && t !== null && d === r && d >= 50 && t >= 100) {
    flags.push("exact_tie");
  }
  return flags;
}

function pushFlag(row, id) {
  if (!row.flags) row.flags = [];
  if (!row.flags.includes(id)) row.flags.push(id);
}

function dominantParty(row) {
  const d = num(row.votes_dem);
  const r = num(row.votes_rep);
  const t = num(row.votes_total);
  if (t === null || t < 20 || d === null || r === null) return null;
  if (d / t >= 0.98) return "d";
  if (r / t >= 0.98) return "r";
  return null;
}

/** County-scoped pattern flags. Mutates row.flags in place. */
export function applyCrossRowFlags(rows) {
  const byCounty = new Map();
  for (const row of rows) {
    const k = row.countyFips || `${row.stateFips || "?"}:none`;
    if (!byCounty.has(k)) byCounty.set(k, []);
    byCounty.get(k).push(row);
  }
  for (const group of byCounty.values()) {
    const buckets = new Map();
    for (const row of group) {
      const d = num(row.votes_dem);
      const r = num(row.votes_rep);
      const t = num(row.votes_total);
      if (t === null || t < 50 || d === null || r === null) continue;
      const key = `${Math.round(d)}|${Math.round(r)}|${Math.round(t)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    for (const list of buckets.values()) {
      if (list.length >= 3) {
        for (const row of list) pushFlag(row, "duplicate_tally");
      }
    }

    group.sort((a, b) => String(a.geoid || "").localeCompare(String(b.geoid || "")));
    let i = 0;
    while (i < group.length) {
      const party = dominantParty(group[i]);
      if (!party) {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < group.length && dominantParty(group[j]) === party) j += 1;
      if (j - i >= 4) {
        for (let k = i; k < j; k++) pushFlag(group[k], "same_candidate_run");
      }
      i = j;
    }

    const ratioBuckets = new Map();
    const zeros = [];
    const lastBuckets = new Map();
    let lastEligible = 0;
    for (const row of group) {
      const d = num(row.votes_dem);
      const r = num(row.votes_rep);
      const t = num(row.votes_total);
      if (t === 0) zeros.push(row);
      const rk = d !== null && r !== null ? twoPartyKey(d, r) : null;
      if (rk != null) {
        if (!ratioBuckets.has(rk)) ratioBuckets.set(rk, []);
        ratioBuckets.get(rk).push(row);
      }
      if (t !== null && t >= 20) {
        lastEligible += 1;
        const digit = Math.trunc(Math.abs(t)) % 10;
        if (!lastBuckets.has(digit)) lastBuckets.set(digit, []);
        lastBuckets.get(digit).push(row);
      }
    }
    for (const list of ratioBuckets.values()) {
      if (list.length >= 5) {
        for (const row of list) pushFlag(row, "ratio_clone");
      }
    }
    if (zeros.length >= 12 && zeros.length / group.length >= 0.15) {
      for (const row of zeros) pushFlag(row, "zero_cluster");
    }
    const lastNeed = Math.max(8, Math.ceil(0.3 * lastEligible));
    for (const list of lastBuckets.values()) {
      if (list.length >= lastNeed) {
        for (const row of list) pushFlag(row, "last_digit_stack");
      }
    }

    for (let k = 0; k + 3 < group.length; k++) {
      const window = group.slice(k, k + 4);
      const totals = window.map((row) => num(row.votes_total));
      if (totals.some((v) => v === null || v < 20)) continue;
      if (isArithmeticRun(totals, 10)) {
        for (const row of window) pushFlag(row, "total_sequence");
      }
    }
  }
}

export function applyFlags(rows, stateStats) {
  for (const row of rows) {
    row.flags = flagRow(row, stateStats[row.stateFips]);
    const o = residual(row);
    row.votes_other = o;
  }
  applyCrossRowFlags(rows);
  for (const row of rows) {
    const n = (row.flags || []).filter((id) => id !== "compound_flag").length;
    if (n >= 3) pushFlag(row, "compound_flag");
  }
  return rows;
}

export function whyFlagged(row, methodId, stateStat) {
  const m = METHOD_BY_ID[methodId];
  if (!m) return "";
  const t = num(row.votes_total);
  const d = num(row.votes_dem);
  const r = num(row.votes_rep);
  const dens = num(row.votes_per_sqkm);
  const lead = num(row.pct_dem_lead);
  const o = residual(row);
  switch (methodId) {
    case "zero_votes":
      return "Reported total is 0.";
    case "negative_residual":
      return `Dem ${d} + Rep ${r} = ${(d || 0) + (r || 0)}, but total is ${t}.`;
    case "other_share":
      return `Non-major share ${t ? ((o / t) * 100).toFixed(1) : "?"}‰ of ${t} votes.`.replace(
        "‰",
        "%",
      );
    case "unanimous":
      return d === t ? `All ${t} votes Democratic.` : `All ${t} votes Republican.`;
    case "near_unanimous":
      return `Lead ${lead} points on ${t} votes.`;
    case "density_spike":
      return `${dens} votes/km² (state P99.5=${stateStat?.densP995}, median=${stateStat?.densMedian}).`;
    case "mega_precinct":
      return `${t} total votes (state P99.5=${stateStat?.votesP995}, median=${stateStat?.votesMedian}).`;
    case "non_integer":
      return `Counts Dem ${d}, Rep ${r}, total ${t} — at least one is not a whole number.`;
    case "negative_votes":
      return `Negative count in Dem ${d}, Rep ${r}, or total ${t}.`;
    case "lead_mismatch": {
      const calc = computedLead(row);
      return `Stored lead ${lead}; from the counts ${calc == null ? "?" : calc.toFixed(2)}.`;
    }
    case "repeating_digits": {
      const hits = [
        ["Dem", d],
        ["Rep", r],
        ["total", t],
      ]
        .filter(([, v]) => hasRepeatingDigits(v))
        .map(([name, v]) => `${name} ${v}`);
      return `Repeating digits in ${hits.join(", ") || "a vote field"}.`;
    }
    case "round_block":
      return `Dem ${d}, Rep ${r}, total ${t} are all multiples of 100.`;
    case "duplicate_tally":
      return `This (Dem ${d}, Rep ${r}, total ${t}) triple is shared by other precincts in the county.`;
    case "same_candidate_run":
      return `GEOID-adjacent precincts in this county each give ≥ 98% to the same party (n=${t}).`;
    case "vote_transfer": {
      const delta = voteDelta(row);
      return `Prior Dem ${row.votes_dem_prev} / Rep ${row.votes_rep_prev} → now ${d} / ${r} (Δ ${delta?.d}, ${delta?.r}; Δtotal ${delta?.t}).`;
    }
    case "count_retraction":
      return `Total fell from ${row.votes_total_prev} to ${t}.`;
    case "one_sided_increment": {
      const delta = voteDelta(row);
      return `Total rose ${delta?.t} from ${row.votes_total_prev}; almost all of the increment is one party (ΔDem ${delta?.d}, ΔRep ${delta?.r}).`;
    }
    case "sequential_digits": {
      const hits = [
        ["Dem", d],
        ["Rep", r],
        ["total", t],
      ]
        .filter(([, v]) => hasSequentialDigits(v))
        .map(([name, v]) => `${name} ${v}`);
      return `Sequential digits in ${hits.join(", ") || "a vote field"}.`;
    }
    case "exact_tie":
      return `Dem ${d} = Rep ${r} on ${t} votes.`;
    case "ratio_clone":
      return `Two-party share ${d !== null && r !== null && d + r ? ((100 * d) / (d + r)).toFixed(1) : "?"}‰ matches other precincts in the county.`.replace(
        "‰",
        "%",
      );
    case "total_sequence":
      return `This precinct sits in a GEOID-adjacent run of totals that step by a constant amount (n=${t}).`;
    case "last_digit_stack":
      return `votes_total ${t} ends in ${t == null ? "?" : Math.trunc(Math.abs(t)) % 10}, a last digit stacked in this county.`;
    case "zero_cluster":
      return "This zero-vote precinct sits in a county with many other zeros.";
    case "compound_flag":
      return `This row also carries ${(row.flags || []).filter((id) => id !== "compound_flag").join(", ") || "multiple flags"}.`;
    default:
      return m.rule;
  }
}

function check(expr, left, right, ok) {
  return { expr, left, right, ok: Boolean(ok) };
}

function share(part, total) {
  if (part === null || total === null || total === 0) return null;
  return part / total;
}

/** Structured, reproducible workup for one precinct's flags. */
export function workupChecks(row, methodId, stateStat, ctx = {}) {
  const d = num(row.votes_dem);
  const r = num(row.votes_rep);
  const t = num(row.votes_total);
  const dens = num(row.votes_per_sqkm);
  const lead = num(row.pct_dem_lead);
  const o = residual(row);
  const delta = voteDelta(row);
  const county = ctx.countyRows || [];

  switch (methodId) {
    case "zero_votes":
      return [check("votes_total == 0", t, 0, t === 0)];
    case "negative_residual":
      return [check("(votes_dem + votes_rep) - votes_total > 0.5", o, -0.5, o !== null && o < -0.5)];
    case "other_share":
      return [
        check("votes_total >= 50", t, 50, t !== null && t >= 50),
        check("(total - dem - rep) / total >= 0.25", o !== null && t ? o / t : null, 0.25, o !== null && t >= 50 && o / t >= 0.25),
      ];
    case "unanimous":
      return [
        check("votes_total >= 50", t, 50, t !== null && t >= 50),
        check("votes_dem == votes_total or votes_rep == votes_total", { d, r, t }, t, t !== null && (d === t || r === t)),
      ];
    case "near_unanimous":
      return [
        check("votes_total >= 100", t, 100, t !== null && t >= 100),
        check("abs(pct_dem_lead) >= 95", lead, 95, lead !== null && Math.abs(lead) >= 95),
      ];
    case "density_spike":
      return [
        check("votes_total >= 20", t, 20, t !== null && t >= 20),
        check("votes_per_sqkm >= state P99.5", dens, stateStat?.densP995 ?? null, dens != null && stateStat && dens >= stateStat.densP995),
        check("votes_per_sqkm >= 8 × state median", dens, stateStat ? stateStat.densMedian * 8 : null, dens != null && stateStat?.densMedian > 0 && dens >= stateStat.densMedian * 8),
      ];
    case "mega_precinct":
      return [
        check("votes_total >= 200", t, 200, t !== null && t >= 200),
        check("votes_total >= state P99.5", t, stateStat?.votesP995 ?? null, t != null && stateStat && t >= stateStat.votesP995),
        check("votes_total >= 5 × state median", t, stateStat ? stateStat.votesMedian * 5 : null, t != null && stateStat?.votesMedian > 0 && t >= stateStat.votesMedian * 5),
      ];
    case "non_integer":
      return [
        check("votes_dem is not an integer", d, null, isNonIntegerVote(d)),
        check("votes_rep is not an integer", r, null, isNonIntegerVote(r)),
        check("votes_total is not an integer", t, null, isNonIntegerVote(t)),
      ];
    case "negative_votes":
      return [
        check("votes_dem < 0", d, 0, d !== null && d < 0),
        check("votes_rep < 0", r, 0, r !== null && r < 0),
        check("votes_total < 0", t, 0, t !== null && t < 0),
      ];
    case "lead_mismatch": {
      const calc = computedLead(row);
      return [
        check("votes_total >= 10", t, 10, t !== null && t >= 10),
        check("abs(stored lead − computed lead) > 1", lead !== null && calc !== null ? Math.abs(lead - calc) : null, 1, lead !== null && calc !== null && t >= 10 && Math.abs(lead - calc) > 1),
      ];
    }
    case "repeating_digits":
      return [
        check("dem has 4+ identical digits", d, null, hasRepeatingDigits(d)),
        check("rep has 4+ identical digits", r, null, hasRepeatingDigits(r)),
        check("total has 4+ identical digits", t, null, hasRepeatingDigits(t)),
      ];
    case "round_block":
      return [
        check("votes_total >= 400", t, 400, t !== null && t >= 400),
        check("votes_dem % 100 == 0", d, 100, d !== null && d % 100 === 0),
        check("votes_rep % 100 == 0", r, 100, r !== null && r % 100 === 0),
        check("votes_total % 100 == 0", t, 100, t !== null && t % 100 === 0),
      ];
    case "duplicate_tally": {
      const key = `${Math.round(d)}|${Math.round(r)}|${Math.round(t)}`;
      const peers = county
        .filter((x) => {
          const dd = num(x.votes_dem);
          const rr = num(x.votes_rep);
          const tt = num(x.votes_total);
          return tt !== null && tt >= 50 && `${Math.round(dd)}|${Math.round(rr)}|${Math.round(tt)}` === key;
        })
        .map((x) => x.geoid);
      return [
        check("votes_total >= 50", t, 50, t !== null && t >= 50),
        check("same (dem, rep, total) on >= 3 precincts in county", peers.length, 3, peers.length >= 3),
      ];
    }
    case "same_candidate_run": {
      const party = dominantParty(row);
      const ordered = [...county].sort((a, b) => String(a.geoid).localeCompare(String(b.geoid)));
      const idx = ordered.findIndex((x) => x.geoid === row.geoid);
      let lo = idx;
      let hi = idx;
      while (lo > 0 && dominantParty(ordered[lo - 1]) === party) lo -= 1;
      while (hi < ordered.length - 1 && dominantParty(ordered[hi + 1]) === party) hi += 1;
      const streak = idx >= 0 ? hi - lo + 1 : 0;
      return [
        check("votes_total >= 20", t, 20, t !== null && t >= 20),
        check("one-party share >= 0.98", Math.max(share(d, t) || 0, share(r, t) || 0), 0.98, party != null),
        check("GEOID-adjacent streak in county >= 4", streak, 4, streak >= 4),
      ];
    }
    case "vote_transfer": {
      const moved = delta && delta.d != null && delta.r != null ? Math.min(Math.abs(delta.d), Math.abs(delta.r)) : null;
      const opposite = Boolean(delta && ((delta.d <= -10 && delta.r >= 10) || (delta.r <= -10 && delta.d >= 10)));
      return [
        check("prior report present", delta != null, true, delta != null),
        check("one party fell by >= 10 and the other rose by >= 10", delta, 10, opposite),
        check("abs(Δdem + Δrep) is small", delta ? Math.abs(delta.d + delta.r) : null, moved != null ? Math.max(5, 0.1 * moved) : null, opposite && delta && Math.abs(delta.d + delta.r) <= Math.max(5, 0.1 * moved)),
        check("abs(Δtotal) is small", delta?.t ?? null, moved != null ? Math.max(5, 0.15 * moved) : null, opposite && delta && Math.abs(delta.t) <= Math.max(5, 0.15 * moved)),
      ];
    }
    case "count_retraction":
      return [
        check("prior report present", delta != null, true, delta != null),
        check("votes_total − votes_total_prev <= -0.5", delta?.t ?? null, -0.5, delta != null && delta.t <= -0.5),
      ];
    case "one_sided_increment": {
      const side = delta ? Math.max(delta.d, delta.r) : null;
      return [
        check("prior report present", delta != null, true, delta != null),
        check("Δtotal >= 150", delta?.t ?? null, 150, delta != null && delta.t >= 150),
        check("max(Δdem, Δrep) / Δtotal >= 0.95", side != null && delta?.t ? side / delta.t : null, 0.95, delta != null && delta.t >= 150 && side >= 0 && side / delta.t >= 0.95),
      ];
    }
    case "sequential_digits":
      return [
        check("dem has 4 sequential digits", d, null, hasSequentialDigits(d)),
        check("rep has 4 sequential digits", r, null, hasSequentialDigits(r)),
        check("total has 4 sequential digits", t, null, hasSequentialDigits(t)),
      ];
    case "exact_tie":
      return [
        check("votes_dem == votes_rep", { d, r }, null, d !== null && r !== null && d === r),
        check("votes_dem >= 50", d, 50, d !== null && d >= 50),
        check("votes_total >= 100", t, 100, t !== null && t >= 100),
      ];
    case "ratio_clone": {
      const key = d !== null && r !== null ? twoPartyKey(d, r) : null;
      const peers = county.filter((x) => twoPartyKey(num(x.votes_dem), num(x.votes_rep)) === key);
      return [
        check("dem + rep >= 60 and share is not a 5% step", d !== null && r !== null ? d + r : null, 60, key != null),
        check("same two-party share on >= 5 precincts in county", peers.length, 5, peers.length >= 5),
      ];
    }
    case "total_sequence":
      return [check("sits in a 4-precinct arithmetic total run", t, 10, t !== null && t >= 20)];
    case "last_digit_stack": {
      const eligible = county.filter((x) => {
        const tt = num(x.votes_total);
        return tt !== null && tt >= 20;
      });
      const digit = t == null ? null : Math.trunc(Math.abs(t)) % 10;
      const peers = eligible.filter((x) => Math.trunc(Math.abs(num(x.votes_total))) % 10 === digit);
      const need = Math.max(8, Math.ceil(0.3 * eligible.length));
      return [
        check("votes_total >= 20", t, 20, t !== null && t >= 20),
        check("same last digit count >= max(8, 30% of county)", peers.length, need, peers.length >= need),
      ];
    }
    case "zero_cluster": {
      const zeros = county.filter((x) => num(x.votes_total) === 0);
      return [
        check("votes_total == 0", t, 0, t === 0),
        check("zero-vote precincts in county >= 12 and >= 15% of county", zeros.length, 12, zeros.length >= 12 && county.length > 0 && zeros.length / county.length >= 0.15),
      ];
    }
    case "compound_flag": {
      const n = (row.flags || []).filter((id) => id !== "compound_flag").length;
      return [check("other flags on this row >= 3", n, 3, n >= 3)];
    }
    default:
      return [];
  }
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

export function buildWorkup(row, stateStat, meta = {}, ctx = {}) {
  const flags = row.flags || [];
  const peers = (ctx.countyRows || []).map((x) => x.geoid).filter((g) => g && g !== row.geoid);
  const body = {
    kind: "electiontrace.workup",
    version: 5,
    geoid: row.geoid,
    stateFips: row.stateFips,
    stateName: row.stateName,
    countyFips: row.countyFips,
    inputs: {
      votes_dem: row.votes_dem ?? null,
      votes_rep: row.votes_rep ?? null,
      votes_total: row.votes_total ?? null,
      votes_other: residual(row),
      votes_per_sqkm: row.votes_per_sqkm ?? null,
      pct_dem_lead: row.pct_dem_lead ?? null,
      computed_lead: computedLead(row),
      votes_dem_prev: row.votes_dem_prev ?? null,
      votes_rep_prev: row.votes_rep_prev ?? null,
      votes_total_prev: row.votes_total_prev ?? null,
    },
    stateThresholds: stateStat
      ? {
          votesMedian: stateStat.votesMedian,
          votesP995: stateStat.votesP995,
          densMedian: stateStat.densMedian,
          densP995: stateStat.densP995,
        }
      : null,
    flags: flags.map((id) => {
      const m = METHOD_BY_ID[id];
      return {
        id,
        name: m?.name || id,
        rule: m?.rule || "",
        why: whyFlagged(row, id, stateStat),
        plain: m?.plain || null,
        checks: workupChecks(row, id, stateStat, ctx),
      };
    }),
    countyPeersSample: peers.slice(0, 12),
    index: {
      indexedAt: meta.indexedAt || null,
      sources: meta.sources || [],
      methods: METHODS.map((m) => m.id),
    },
  };
  return body;
}
