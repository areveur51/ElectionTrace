/**
 * Load NYT 2020 election-night JSON (one file per state).
 * These files have candidate names and a reporting timeseries
 * the precinct GeoJSON does not.
 */
import fs from "fs";
import path from "path";
import { analyzeRace } from "./nytAnomalies.mjs";

const POSTAL_TO_FIPS = {
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
  DE: "10",
  DC: "11",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
};

function downsample(arr, max = 80) {
  if (!Array.isArray(arr) || arr.length <= max) return arr || [];
  const out = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.round(i * step)]);
  }
  const last = arr[arr.length - 1];
  if (out[out.length - 1] !== last) out[out.length - 1] = last;
  return out;
}

function compactCandidate(c) {
  return {
    key: c.candidate_key,
    id: c.candidate_id,
    name: c.name_display,
    first: c.first_name,
    last: c.last_name,
    party: c.party_id,
    votes: c.votes,
    percent: c.percent,
    winner: Boolean(c.winner),
  };
}

function compactCounty(c) {
  return {
    fips: c.fips,
    name: c.name,
    votes: c.votes,
    results: c.results || {},
    leader: c.leader_margin_name_display || "",
    party: c.leader_party_id || "",
  };
}

function compactPoint(p, demKey, repKey) {
  const shares = p.vote_shares || {};
  const total = Number(p.votes) || 0;
  const demShare = Number(shares[demKey]) || 0;
  const repShare = Number(shares[repKey]) || 0;
  return {
    t: p.timestamp,
    votes: total,
    eevp: p.eevp,
    votes_dem: Math.round(demShare * total),
    votes_rep: Math.round(repShare * total),
    share_dem: demShare,
    share_rep: repShare,
  };
}

export function parseStateRace(raw) {
  const race = raw?.data?.races?.[0];
  if (!race) return null;
  const postal = String(race.state_id || "").toUpperCase();
  const fips = POSTAL_TO_FIPS[postal];
  if (!fips) return null;
  const candidates = (race.candidates || []).map(compactCandidate);
  const dem = candidates.find((c) => c.party === "democrat");
  const rep = candidates.find((c) => c.party === "republican");
  const others = candidates.filter((c) => c !== dem && c !== rep);
  const ts = downsample(race.timeseries || [], 80).map((p) =>
    compactPoint(p, dem?.key || "bidenj", rep?.key || "trumpd"),
  );
  const findings = analyzeRace(race);
  return {
    fips,
    postal,
    name: race.state_name,
    office: race.office || "President",
    election_date: race.election_date,
    last_updated: race.last_updated,
    votes: race.votes,
    eevp: race.eevp,
    leader: race.leader_margin_name_display,
    candidates,
    dem: dem || null,
    rep: rep || null,
    others,
    counties: (race.counties || []).map(compactCounty),
    timeseries: ts,
    votes2016: race.votes2016 ?? null,
    clinton2016: race.clinton2016 ?? null,
    trump2016: race.trump2016 ?? null,
    findings,
  };
}

export function loadNytStates(dir) {
  const byFips = {};
  if (!dir || !fs.existsSync(dir)) return byFips;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "package.json") continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const race = parseStateRace(raw);
      if (race) byFips[race.fips] = race;
    } catch {
      // skip a bad file rather than failing the whole load
    }
  }
  return byFips;
}

function dirHasJson(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((n) => n.endsWith(".json") && n !== "package.json");
}

export function nytStatesDir(root) {
  if (process.env.NYT_STATES_DIR) return process.env.NYT_STATES_DIR;
  const local = path.join(root, "media", "nyt-election-data");
  if (dirHasJson(local)) return local;
  const sample = path.join(root, "media", "sample", "nyt-election-data");
  if (dirHasJson(sample)) return sample;
  return local;
}

export function countyWinnerRow(county, race) {
  const results = county?.results || {};
  const demKey = race?.dem?.key;
  const repKey = race?.rep?.key;
  const demVotes = Number(results[demKey]) || 0;
  const repVotes = Number(results[repKey]) || 0;
  let otherVotes = 0;
  let otherTopKey = null;
  let otherTopVotes = 0;
  for (const [k, v] of Object.entries(results)) {
    if (k === demKey || k === repKey) continue;
    const n = Number(v) || 0;
    otherVotes += n;
    if (n > otherTopVotes) {
      otherTopVotes = n;
      otherTopKey = k;
    }
  }
  const votes = Number(county.votes) || demVotes + repVotes + otherVotes;
  let winnerParty = county.party || "";
  let winner = "";
  let winnerVotes = 0;
  if (demVotes > repVotes && demVotes >= otherTopVotes) {
    winnerParty = "democrat";
    winner = race.dem?.last || race.dem?.name || "Democrat";
    winnerVotes = demVotes;
  } else if (repVotes > demVotes && repVotes >= otherTopVotes) {
    winnerParty = "republican";
    winner = race.rep?.last || race.rep?.name || "Republican";
    winnerVotes = repVotes;
  } else if (otherTopVotes > demVotes && otherTopVotes > repVotes) {
    winnerParty = "other";
    winner = otherTopKey || "Other";
    winnerVotes = otherTopVotes;
  } else if (winnerParty === "democrat") {
    winner = race.dem?.last || "Democrat";
    winnerVotes = demVotes;
  } else if (winnerParty === "republican") {
    winner = race.rep?.last || "Republican";
    winnerVotes = repVotes;
  }
  const margin = votes > 0 ? (100 * Math.abs(demVotes - repVotes)) / votes : 0;
  return {
    fips: String(county.fips || "").padStart(5, "0"),
    name: county.name || "",
    stateFips: race.fips,
    stateName: race.name,
    postal: race.postal,
    winner,
    winnerParty,
    winnerVotes,
    demVotes,
    repVotes,
    otherVotes,
    votes,
    margin,
    leader: county.leader || "",
  };
}

export function countyWinners(nytByFips) {
  const races = Object.values(nytByFips || {});
  const sample = races[0] || {};
  const byFips = {};
  for (const race of races) {
    for (const county of race.counties || []) {
      const row = countyWinnerRow(county, race);
      if (row.fips && row.fips !== "00000") byFips[row.fips] = row;
    }
  }
  return {
    office: sample.office || "President",
    election_date: sample.election_date || "2020-11-03",
    dem: sample.dem
      ? { key: sample.dem.key, last: sample.dem.last, name: sample.dem.name }
      : null,
    rep: sample.rep
      ? { key: sample.rep.key, last: sample.rep.last, name: sample.rep.name }
      : null,
    n: Object.keys(byFips).length,
    counties: byFips,
  };
}

function numVotes(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function voteLedger(plus, minusAbs) {
  const plusN = numVotes(plus);
  const minusN = -Math.abs(numVotes(minusAbs));
  return { plus: plusN, minus: minusN, net: plusN + minusN };
}

/** Count filtered precincts by the presidential winner of their county. */
export function tallyByCountyWinner(items, winnersByFips) {
  const out = {
    dem: 0,
    rep: 0,
    other: 0,
    unknown: 0,
    total: 0,
    votes: {
      dem: { plus: 0, minus: 0, net: 0 },
      rep: { plus: 0, minus: 0, net: 0 },
    },
  };
  let demVotes = 0;
  let repVotes = 0;
  for (const item of items || []) {
    const n = Number(item.n);
    const add = Number.isFinite(n) && n > 0 ? n : 1;
    out.total += add;
    const raw = String(item.countyFips || item.fips || "").replace(/\D/g, "");
    const fips = raw.padStart(5, "0");
    const party = winnersByFips?.[fips]?.winnerParty;
    if (party === "democrat") out.dem += add;
    else if (party === "republican") out.rep += add;
    else if (party) out.other += add;
    else out.unknown += add;
    demVotes += numVotes(item.votes_dem ?? item.votesDem);
    repVotes += numVotes(item.votes_rep ?? item.votesRep);
  }
  out.votes.dem = voteLedger(demVotes, repVotes);
  out.votes.rep = voteLedger(repVotes, demVotes);
  return out;
}

export function publicRace(race, countyFips) {
  if (!race) return null;
  const county = countyFips
    ? (race.counties || []).find((c) => c.fips === countyFips) || null
    : null;
  return {
    fips: race.fips,
    postal: race.postal,
    name: race.name,
    office: race.office,
    election_date: race.election_date,
    last_updated: race.last_updated,
    votes: race.votes,
    eevp: race.eevp,
    leader: race.leader,
    dem: race.dem,
    rep: race.rep,
    others: race.others,
    timeseries: race.timeseries,
    votes2016: race.votes2016,
    clinton2016: race.clinton2016,
    trump2016: race.trump2016,
    county,
    findings: {
      retractions: race.findings?.retractions || [],
      flips: race.findings?.flips || [],
      dumps: race.findings?.dumps || [],
      errors: race.findings?.errors || [],
      countyMismatch: race.findings?.countyMismatch || 0,
    },
  };
}
