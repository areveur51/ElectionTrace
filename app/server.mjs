#!/usr/bin/env node
/**
 * ElectionTrace — HTTPS/HTTP API + static UI.
 */
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { buildIndex, explainRow, indexIsFresh, loadIndex, resolveMediaDir } from "./lib/index.mjs";
import { createHash } from "crypto";
import { METHODS, METHOD_BY_ID, buildWorkup } from "./lib/methods.mjs";
import { normalizeHistory, resolveCandidates } from "./lib/candidates.mjs";
import {
  countyWinners,
  loadNytStates,
  nytStatesDir,
  publicRace,
  tallyByCountyWinner,
} from "./lib/nytStates.mjs";
import { summarizeFindings, buildCoverage } from "./lib/nytAnomalies.mjs";
import {
  coverage,
  databaseUrl,
  ensureSchema,
  getPool,
  getPrecinct,
  loadMeta,
  queryAnomalies,
  queryCountyRows,
  queryCountyTally,
  queryGeojson,
} from "./lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\n/)) {
    const line = raw.replace(/\r/g, "").trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(path.join(ROOT, ".env"));

const port = Number(process.env.PORT || 5200);
const host = process.env.HOST || "0.0.0.0";
const mediaDir = resolveMediaDir(ROOT, path.resolve(process.env.MEDIA_DIR || path.join(ROOT, "media")));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const keyPath = process.env.HTTPS_KEY;
const certPath = process.env.HTTPS_CERT;

const store = {
  rows: [],
  byGeoid: new Map(),
  meta: null,
  pool: null,
  indexing: false,
  indexError: null,
  progress: null,
  ready: false,
  nytByFips: {},
  countyWinners: null,
};

function setMemoryIndex(loaded) {
  store.rows = loaded.rows;
  store.meta = loaded.meta;
  store.byGeoid = new Map(loaded.rows.map((r) => [r.geoid, r]));
  store.ready = true;
  store.indexing = false;
  store.indexError = null;
}

function dropMemoryRows() {
  store.rows = [];
  store.byGeoid = new Map();
}

async function ensureIndex() {
  try {
    store.nytByFips = loadNytStates(nytStatesDir(ROOT));
    console.log(`[electiontrace] nyt state files=${Object.keys(store.nytByFips).length}`);
    if (databaseUrl()) {
      store.pool = await getPool();
      await ensureSchema(store.pool);
    }
    if (indexIsFresh(dataDir, mediaDir)) {
      if (store.pool) {
        store.meta = (await loadMeta(store.pool)) || loadIndex(dataDir)?.meta;
        if (store.meta) {
          const cov = await coverage(store.pool);
          store.meta = { ...store.meta, ...cov, backend: "postgres" };
          store.ready = true;
          store.indexing = false;
          console.log(
            `[electiontrace] postgres precincts=${cov.precincts} flagged=${cov.flagged} mappable=${cov.mappable}`,
          );
          return;
        }
      } else {
        const loaded = loadIndex(dataDir);
        if (loaded) {
          setMemoryIndex(loaded);
          console.log(
            `[electiontrace] jsonl precincts=${loaded.meta.precincts} flagged=${loaded.meta.flagged}`,
          );
          return;
        }
      }
    }
    store.indexing = true;
    store.ready = false;
    console.log("[electiontrace] building index from", mediaDir);
    const built = await buildIndex(mediaDir, dataDir, {
      onFile: (f) => {
        store.progress = { file: f, scanned: 0 };
        console.log("[electiontrace] scan", f);
      },
      onProgress: (p) => {
        store.progress = p;
      },
    });
    store.meta = built.meta;
    if (store.pool) {
      dropMemoryRows();
      built.rows.length = 0;
    } else {
      setMemoryIndex(built);
    }
    store.ready = true;
    store.indexing = false;
    console.log(
      `[electiontrace] indexed precincts=${built.meta.precincts} flagged=${built.meta.flagged} backend=${built.meta.backend}`,
    );
  } catch (e) {
    store.indexing = false;
    store.indexError = e instanceof Error ? e.message : String(e);
    console.error("[electiontrace] index failed:", store.indexError);
  }
}

function json(res, code, body) {
  const raw = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(raw);
}

function notReady(res) {
  return json(res, 503, {
    ok: false,
    indexing: store.indexing,
    progress: store.progress,
    error: store.indexError,
  });
}

function parseUrl(req) {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  return u;
}

function filterRows(query) {
  const state = (query.get("state") || "").trim();
  const type = (query.get("type") || "").trim();
  const q = (query.get("q") || "").trim().toLowerCase();
  const flaggedOnly = query.get("all") !== "1";
  let rows = store.rows;
  if (flaggedOnly) rows = rows.filter((r) => r.flags && r.flags.length);
  if (state && state !== "all") {
    rows = rows.filter((r) => r.stateFips === state || r.stateName.toLowerCase() === state.toLowerCase());
  }
  if (type) rows = rows.filter((r) => r.flags.includes(type));
  if (q) {
    rows = rows.filter(
      (r) =>
        r.geoid.toLowerCase().includes(q) ||
        r.stateName.toLowerCase().includes(q) ||
        r.countyFips.includes(q),
    );
  }
  return rows;
}

function electionCandidates() {
  const sourceName = store.meta?.sources?.[0]?.file || "";
  const base = store.meta?.candidates || resolveCandidates({ sourceName });
  const sample = Object.values(store.nytByFips)[0];
  if (sample?.dem && sample?.rep) {
    return {
      ...base,
      dem: sample.dem.name,
      demShort: sample.dem.last || base.demShort,
      rep: sample.rep.name,
      repShort: sample.rep.last || base.repShort,
      others: (sample.others || []).map((c) => c.name),
    };
  }
  return base;
}

function rowHistory(row) {
  if (Array.isArray(row.history) && row.history.length) return row.history;
  return normalizeHistory({}, row);
}

function publicRow(row) {
  const candidates = electionCandidates();
  return {
    geoid: row.geoid,
    stateFips: row.stateFips,
    stateName: row.stateName,
    countyFips: row.countyFips,
    votes_dem: row.votes_dem,
    votes_rep: row.votes_rep,
    votes_total: row.votes_total,
    votes_other: row.votes_other,
    votes_per_sqkm: row.votes_per_sqkm,
    pct_dem_lead: row.pct_dem_lead,
    votes_dem_prev: row.votes_dem_prev ?? null,
    votes_rep_prev: row.votes_rep_prev ?? null,
    votes_total_prev: row.votes_total_prev ?? null,
    candidate_dem: row.candidate_dem || candidates.dem,
    candidate_rep: row.candidate_rep || candidates.rep,
    candidates,
    history: rowHistory(row),
    lat: row.lat,
    lng: row.lng,
    flags: row.flags,
    why: explainRow(row, store.meta?.stateStats),
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".geojson": "application/geo+json; charset=utf-8",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, url) {
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  if (rel.includes("..")) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function handler(req, res) {
  Promise.resolve(handle(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: e.message || "error" });
  });
}

async function handle(req, res) {
  const url = parseUrl(req);
  const p = url.pathname;

  if (p === "/api/health" || p === "/health") {
    return json(res, store.indexError && !store.ready ? 503 : 200, {
      ok: !store.indexError || store.ready,
      service: "electiontrace",
      ready: store.ready,
      indexing: store.indexing,
      progress: store.progress,
      precincts: store.meta?.precincts || 0,
      flagged: store.meta?.flagged || 0,
      mappable: store.meta?.mappable || 0,
      unmapped: store.meta?.unmapped || 0,
      backend: store.meta?.backend || (store.pool ? "postgres" : "jsonl"),
      error: store.indexError,
      ts: new Date().toISOString(),
    });
  }

  if (p === "/api/methods") {
    return json(res, 200, { methods: METHODS });
  }

  if (p === "/api/summary") {
    if (!store.ready) return notReady(res);
    return json(res, 200, {
      ok: true,
      indexedAt: store.meta.indexedAt,
      sources: store.meta.sources,
      precincts: store.meta.precincts,
      flagged: store.meta.flagged,
      mappable: store.meta.mappable,
      unmapped: store.meta.unmapped,
      backend: store.meta.backend || (store.pool ? "postgres" : "jsonl"),
      byType: store.meta.byType,
      states: store.meta.states,
      methods: METHODS,
      candidates: electionCandidates(),
      benford: Object.fromEntries(
        Object.entries(store.meta.stateStats || {}).map(([k, v]) => [k, v.benford]),
      ),
      coverage: buildCoverage(store.meta.states, store.nytByFips),
    });
  }

  if (p === "/api/states") {
    if (!store.ready) return notReady(res);
    return json(res, 200, { states: store.meta.states });
  }

  if (p === "/api/anomalies") {
    if (!store.ready) return notReady(res);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    if (store.pool) {
      const out = await queryAnomalies(store.pool, {
        state: url.searchParams.get("state") || "",
        type: url.searchParams.get("type") || "",
        q: url.searchParams.get("q") || "",
        flaggedOnly: url.searchParams.get("all") !== "1",
        limit,
        offset,
      });
      return json(res, 200, {
        total: out.total,
        limit,
        offset,
        rows: out.rows.map(publicRow),
      });
    }
    const rows = filterRows(url.searchParams);
    return json(res, 200, {
      total: rows.length,
      limit,
      offset,
      rows: rows.slice(offset, offset + limit).map(publicRow),
    });
  }

  if (p === "/api/anomalies.geojson") {
    if (!store.ready) return notReady(res);
    let rows;
    if (store.pool) {
      rows = await queryGeojson(store.pool, {
        state: url.searchParams.get("state") || "",
        type: url.searchParams.get("type") || "",
        q: url.searchParams.get("q") || "",
        flaggedOnly: url.searchParams.get("all") !== "1",
        cap: 8000,
      });
    } else {
      rows = filterRows(url.searchParams).filter((r) => r.lat != null && r.lng != null);
    }
    const cap = Math.min(8000, rows.length);
    const fc = {
      type: "FeatureCollection",
      features: rows.slice(0, cap).map((r) => ({
        type: "Feature",
        properties: {
          geoid: r.geoid,
          state: r.stateName || r.state,
          flags: r.flags,
          votes_total: r.votes_total,
          pct_dem_lead: r.pct_dem_lead,
          color: METHOD_BY_ID[r.flags[0]]?.color || "#8b97b0",
        },
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      })),
    };
    return json(res, 200, fc);
  }

  if (p === "/api/findings") {
    if (!store.ready) return notReady(res);
    return json(res, 200, summarizeFindings(store.nytByFips));
  }

  if (p === "/api/county-winners") {
    if (!store.ready) return notReady(res);
    if (!store.countyWinners) store.countyWinners = countyWinners(store.nytByFips);
    return json(res, 200, store.countyWinners);
  }

  if (p === "/api/anomalies-by-winner") {
    if (!store.ready) return notReady(res);
    if (!store.countyWinners) store.countyWinners = countyWinners(store.nytByFips);
    const q = {
      state: url.searchParams.get("state") || "",
      type: url.searchParams.get("type") || "",
      q: url.searchParams.get("q") || "",
      flaggedOnly: url.searchParams.get("all") !== "1",
      excludeZeroVotes: true,
    };
    const items = store.pool
      ? await queryCountyTally(store.pool, q)
      : filterRows(url.searchParams)
          .filter((r) => {
            const flags = r.flags || [];
            return !flags.includes("zero_votes") && !flags.includes("zero_cluster");
          })
          .map((r) => ({
            countyFips: r.countyFips,
            n: 1,
            votes_dem: r.votes_dem,
            votes_rep: r.votes_rep,
          }));
    return json(res, 200, {
      ...tallyByCountyWinner(items, store.countyWinners.counties),
      flaggedOnly: q.flaggedOnly,
    });
  }

  if (p === "/api/race") {
    if (!store.ready) return notReady(res);
    const fips = String(url.searchParams.get("state") || "").padStart(2, "0");
    const county = url.searchParams.get("county") || "";
    const race = store.nytByFips[fips];
    if (!race) return json(res, 404, { error: "no state race file", fips });
    return json(res, 200, publicRace(race, county));
  }

  if (p.startsWith("/api/precincts/")) {
    if (!store.ready) return notReady(res);
    let rest = decodeURIComponent(p.slice("/api/precincts/".length));
    const wantWorkup = rest.endsWith("/workup");
    if (wantWorkup) rest = rest.slice(0, -"/workup".length);
    const geoid = rest;
    const row = store.pool
      ? await getPrecinct(store.pool, geoid)
      : store.byGeoid.get(geoid);
    if (!row) return json(res, 404, { error: "not found" });
    if (!wantWorkup) return json(res, 200, publicRow(row));
    let countyRows = [];
    if (row.countyFips) {
      countyRows = store.pool
        ? await queryCountyRows(store.pool, row.countyFips)
        : store.rows.filter((r) => r.countyFips === row.countyFips);
    }
    const workup = buildWorkup(row, store.meta?.stateStats?.[row.stateFips], store.meta, {
      countyRows,
    });
    workup.candidates = electionCandidates();
    workup.history = rowHistory(row);
    const digest = createHash("sha256")
      .update(JSON.stringify(workup))
      .digest("hex");
    return json(res, 200, { ...workup, sha256: digest });
  }

  if (p.startsWith("/api/")) {
    return json(res, 404, { error: "unknown endpoint" });
  }

  return serveStatic(req, res, url);
}

const useTls =
  keyPath &&
  certPath &&
  fs.existsSync(keyPath) &&
  fs.existsSync(certPath);

const server = useTls
  ? https.createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      handler,
    )
  : http.createServer(handler);

server.listen(port, host, () => {
  const scheme = useTls ? "https" : "http";
  console.log(`[electiontrace] ${scheme}://${host}:${port}`);
  ensureIndex();
});
