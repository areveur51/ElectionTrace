/**
 * Optional shared Postgres. When DATABASE_URL is unset the JSONL index
 * is still written for GitHub / laptop setups.
 */

let pool = null;

export function databaseUrl() {
  let u = (process.env.DATABASE_URL || "").trim();
  if (
    (u.startsWith('"') && u.endsWith('"')) ||
    (u.startsWith("'") && u.endsWith("'"))
  ) {
    u = u.slice(1, -1);
  }
  return u;
}

export async function getPool() {
  const url = databaseUrl();
  if (!url) return null;
  if (pool) return pool;
  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "DATABASE_URL is set but the 'pg' package is missing. Run: npm install pg",
    );
  }
  pool = new pg.default.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 4),
    idleTimeoutMillis: 10_000,
  });
  return pool;
}

export async function ensureSchema(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS et_precincts (
      geoid text PRIMARY KEY,
      state_fips text NOT NULL,
      state_name text,
      county_fips text,
      votes_dem double precision,
      votes_rep double precision,
      votes_total double precision,
      votes_other double precision,
      votes_per_sqkm double precision,
      pct_dem_lead double precision,
      votes_dem_prev double precision,
      votes_rep_prev double precision,
      votes_total_prev double precision,
      lat double precision,
      lng double precision,
      flags text[] NOT NULL DEFAULT '{}',
      source text
    );
    ALTER TABLE et_precincts ADD COLUMN IF NOT EXISTS votes_dem_prev double precision;
    ALTER TABLE et_precincts ADD COLUMN IF NOT EXISTS votes_rep_prev double precision;
    ALTER TABLE et_precincts ADD COLUMN IF NOT EXISTS votes_total_prev double precision;
    ALTER TABLE et_precincts ADD COLUMN IF NOT EXISTS candidate_dem text;
    ALTER TABLE et_precincts ADD COLUMN IF NOT EXISTS candidate_rep text;
    ALTER TABLE et_precincts ADD COLUMN IF NOT EXISTS election_year integer;
    ALTER TABLE et_precincts ADD COLUMN IF NOT EXISTS history jsonb;
    CREATE INDEX IF NOT EXISTS et_precincts_state_idx ON et_precincts (state_fips);
    CREATE INDEX IF NOT EXISTS et_precincts_flags_idx ON et_precincts USING GIN (flags);
    CREATE INDEX IF NOT EXISTS et_precincts_map_idx ON et_precincts (lat, lng)
      WHERE lat IS NOT NULL AND lng IS NOT NULL;
    CREATE TABLE IF NOT EXISTS et_meta (
      k text PRIMARY KEY,
      v jsonb NOT NULL
    );
  `);
}

export async function replacePrecincts(p, rows, meta) {
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE et_precincts");
    const cols = 21;
    const chunkSize = 150;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const params = [];
      const values = chunk.map((r, j) => {
        const o = j * cols;
        params.push(
          r.geoid,
          r.stateFips || "?",
          r.stateName,
          r.countyFips,
          r.votes_dem,
          r.votes_rep,
          r.votes_total,
          r.votes_other,
          r.votes_per_sqkm,
          r.pct_dem_lead,
          r.votes_dem_prev ?? null,
          r.votes_rep_prev ?? null,
          r.votes_total_prev ?? null,
          r.candidate_dem ?? null,
          r.candidate_rep ?? null,
          r.election_year ?? null,
          r.history ? JSON.stringify(r.history) : null,
          r.lat,
          r.lng,
          r.flags || [],
          r.source || null,
        );
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12},$${o + 13},$${o + 14},$${o + 15},$${o + 16},$${o + 17},$${o + 18},$${o + 19},$${o + 20},$${o + 21})`;
      });
      await client.query(
        `INSERT INTO et_precincts (
          geoid, state_fips, state_name, county_fips,
          votes_dem, votes_rep, votes_total, votes_other,
          votes_per_sqkm, pct_dem_lead,
          votes_dem_prev, votes_rep_prev, votes_total_prev,
          candidate_dem, candidate_rep, election_year, history,
          lat, lng, flags, source
        ) VALUES ${values.join(",")}`,
        params,
      );
    }
    await client.query(
      `INSERT INTO et_meta (k, v) VALUES ('summary', $1::jsonb)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
      [JSON.stringify(meta)],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function loadMeta(p) {
  const { rows } = await p.query(`SELECT v FROM et_meta WHERE k = 'summary'`);
  return rows[0]?.v || null;
}

export async function queryAnomalies(p, { state, type, q, flaggedOnly, limit, offset }) {
  const params = [];
  const where = [];
  if (flaggedOnly) where.push("cardinality(flags) > 0");
  if (state && state !== "all") {
    params.push(state);
    where.push(`(state_fips = $${params.length} OR lower(state_name) = lower($${params.length}))`);
  }
  if (type) {
    params.push(type);
    where.push(`$${params.length} = ANY(flags)`);
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(
      `(lower(geoid) LIKE $${params.length} OR lower(state_name) LIKE $${params.length} OR county_fips LIKE $${params.length})`,
    );
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await p.query(`SELECT count(*)::int AS n FROM et_precincts ${clause}`, params);
  params.push(limit);
  const lim = `$${params.length}`;
  params.push(offset);
  const off = `$${params.length}`;
  const { rows } = await p.query(
    `SELECT geoid, state_fips AS "stateFips", state_name AS "stateName",
            county_fips AS "countyFips", votes_dem, votes_rep, votes_total,
            votes_other, votes_per_sqkm, pct_dem_lead,
            votes_dem_prev AS "votes_dem_prev",
            votes_rep_prev AS "votes_rep_prev",
            votes_total_prev AS "votes_total_prev",
            candidate_dem AS "candidate_dem",
            candidate_rep AS "candidate_rep",
            election_year AS "election_year",
            history,
            lat, lng, flags, source
     FROM et_precincts ${clause}
     ORDER BY state_name, geoid
     LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  return { total: count.rows[0].n, rows };
}

export async function queryGeojson(p, { state, type, q, flaggedOnly, cap }) {
  const params = [];
  const where = ["lat IS NOT NULL", "lng IS NOT NULL"];
  if (flaggedOnly) where.push("cardinality(flags) > 0");
  if (state && state !== "all") {
    params.push(state);
    where.push(`(state_fips = $${params.length} OR lower(state_name) = lower($${params.length}))`);
  }
  if (type) {
    params.push(type);
    where.push(`$${params.length} = ANY(flags)`);
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`lower(geoid) LIKE $${params.length}`);
  }
  params.push(cap);
  const { rows } = await p.query(
    `SELECT geoid, state_name AS "stateName", flags, votes_total, pct_dem_lead, lat, lng
     FROM et_precincts
     WHERE ${where.join(" AND ")}
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function queryCountyTally(p, { state, type, q, flaggedOnly, excludeZeroVotes }) {
  const params = [];
  const where = [];
  if (flaggedOnly) where.push("cardinality(flags) > 0");
  if (excludeZeroVotes) {
    where.push("NOT ('zero_votes' = ANY(flags) OR 'zero_cluster' = ANY(flags))");
  }
  if (state && state !== "all") {
    params.push(state);
    where.push(`(state_fips = $${params.length} OR lower(state_name) = lower($${params.length}))`);
  }
  if (type) {
    params.push(type);
    where.push(`$${params.length} = ANY(flags)`);
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(
      `(lower(geoid) LIKE $${params.length} OR lower(state_name) LIKE $${params.length} OR county_fips LIKE $${params.length})`,
    );
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await p.query(
    `SELECT county_fips AS "countyFips",
            count(*)::int AS n,
            COALESCE(sum(votes_dem), 0)::float AS "votes_dem",
            COALESCE(sum(votes_rep), 0)::float AS "votes_rep"
     FROM et_precincts ${clause}
     GROUP BY county_fips`,
    params,
  );
  return rows;
}

export async function queryCountyRows(p, countyFips) {
  if (!countyFips) return [];
  const { rows } = await p.query(
    `SELECT geoid, votes_dem, votes_rep, votes_total, flags
     FROM et_precincts WHERE county_fips = $1 ORDER BY geoid`,
    [countyFips],
  );
  return rows;
}

export async function getPrecinct(p, geoid) {
  const { rows } = await p.query(
    `SELECT geoid, state_fips AS "stateFips", state_name AS "stateName",
            county_fips AS "countyFips", votes_dem, votes_rep, votes_total,
            votes_other, votes_per_sqkm, pct_dem_lead,
            votes_dem_prev AS "votes_dem_prev",
            votes_rep_prev AS "votes_rep_prev",
            votes_total_prev AS "votes_total_prev",
            candidate_dem AS "candidate_dem",
            candidate_rep AS "candidate_rep",
            election_year AS "election_year",
            history,
            lat, lng, flags, source
     FROM et_precincts WHERE geoid = $1`,
    [geoid],
  );
  return rows[0] || null;
}

export async function coverage(p) {
  const { rows } = await p.query(`
    SELECT
      count(*)::int AS precincts,
      count(*) FILTER (WHERE cardinality(flags) > 0)::int AS flagged,
      count(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL)::int AS mappable,
      count(*) FILTER (WHERE lat IS NULL OR lng IS NULL)::int AS unmapped
    FROM et_precincts
  `);
  return rows[0];
}
