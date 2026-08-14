/**
 * Resolve presidential (or override) candidate names for a results file.
 * The lab extract `precincts-with-results.geojson.gz` is the NYT/Upshot
 * 2020 precinct map: votes_dem = Joseph R. Biden Jr., votes_rep = Donald J. Trump.
 */

export const ROSTERS = {
  2024: {
    year: 2024,
    office: "President",
    dem: "Kamala D. Harris",
    demShort: "Harris",
    rep: "Donald J. Trump",
    repShort: "Trump",
    other: "Other",
  },
  2020: {
    year: 2020,
    office: "President",
    dem: "Joseph R. Biden Jr.",
    demShort: "Biden",
    rep: "Donald J. Trump",
    repShort: "Trump",
    other: "Other",
  },
  2016: {
    year: 2016,
    office: "President",
    dem: "Hillary Clinton",
    demShort: "Clinton",
    rep: "Donald J. Trump",
    repShort: "Trump",
    other: "Other",
  },
};

export function yearFromName(name) {
  const s = String(name || "");
  const m = s.match(/\b(20(?:16|20|24))\b/);
  return m ? Number(m[1]) : null;
}

export function resolveYear({ sourceName, props, envYear } = {}) {
  const fromProp = Number(props?.year || props?.election_year || props?.cycle);
  if (fromProp === 2016 || fromProp === 2020 || fromProp === 2024) return fromProp;
  const fromFile = yearFromName(sourceName);
  if (fromFile) return fromFile;
  const fromEnv = Number(envYear || process.env.ELECTION_YEAR);
  if (fromEnv === 2016 || fromEnv === 2020 || fromEnv === 2024) return fromEnv;
  return 2020;
}

export function resolveCandidates({ sourceName, props, envYear } = {}) {
  const year = resolveYear({ sourceName, props, envYear });
  const base = { ...(ROSTERS[year] || ROSTERS[2020]) };
  const dem =
    props?.candidate_dem ||
    props?.dem_candidate ||
    props?.candidate_d ||
    process.env.CANDIDATE_DEM;
  const rep =
    props?.candidate_rep ||
    props?.rep_candidate ||
    props?.candidate_r ||
    process.env.CANDIDATE_REP;
  if (dem) {
    base.dem = String(dem);
    base.demShort = String(dem).split(/\s+/).pop();
  }
  if (rep) {
    base.rep = String(rep);
    base.repShort = String(rep).split(/\s+/).pop();
  }
  if (props?.office) base.office = String(props.office);
  return base;
}

export function normalizeHistory(props = {}, current = {}) {
  const raw = props.history || props.reports || props.snapshots || props.timeseries;
  let series = [];
  if (Array.isArray(raw)) {
    series = raw
      .map((h, i) => ({
        t: h?.ts || h?.time || h?.reported_at || h?.date || h?.label || `Report ${i + 1}`,
        order: Date.parse(h?.ts || h?.time || h?.reported_at || h?.date || "") || i,
        votes_dem: h?.votes_dem ?? h?.dem ?? null,
        votes_rep: h?.votes_rep ?? h?.rep ?? null,
        votes_total: h?.votes_total ?? h?.total ?? null,
      }))
      .sort((a, b) => a.order - b.order);
  }
  if (series.length < 2 && current.votes_total_prev != null) {
    series = [
      {
        t: "Prior report",
        order: 0,
        votes_dem: current.votes_dem_prev ?? null,
        votes_rep: current.votes_rep_prev ?? null,
        votes_total: current.votes_total_prev ?? null,
      },
      {
        t: "Latest",
        order: 1,
        votes_dem: current.votes_dem ?? null,
        votes_rep: current.votes_rep ?? null,
        votes_total: current.votes_total ?? null,
      },
    ];
  }
  return series.length ? series : null;
}
