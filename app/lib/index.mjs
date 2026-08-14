import fs from "fs";
import path from "path";
import { scanGeojsonFile } from "./scan.mjs";
import { METHODS, applyFlags, buildStateStats, whyFlagged } from "./methods.mjs";
import { resolveCandidates } from "./candidates.mjs";
import {
  databaseUrl,
  ensureSchema,
  getPool,
  replacePrecincts,
} from "./db.mjs";

export function mediaFiles(mediaDir) {
  if (!fs.existsSync(mediaDir)) return [];
  return fs
    .readdirSync(mediaDir)
    .filter((n) => /\.geojson(\.gz)?$/i.test(n))
    .map((n) => path.join(mediaDir, n))
    .sort();
}

/** Use committed sample precincts when the operator has not added a full extract. */
export function resolveMediaDir(root, preferred) {
  const want = preferred || path.join(root, "media");
  if (mediaFiles(want).length) return want;
  const sample = path.join(root, "media", "sample");
  if (mediaFiles(sample).length) return sample;
  return want;
}

function sourceStamp(files) {
  return files.map((f) => {
    const st = fs.statSync(f);
    return { file: path.basename(f), bytes: st.size, mtimeMs: st.mtimeMs };
  });
}

export function indexPaths(dataDir) {
  return {
    meta: path.join(dataDir, "meta.json"),
    precincts: path.join(dataDir, "precincts.jsonl"),
  };
}

export function indexIsFresh(dataDir, mediaDir) {
  const { meta } = indexPaths(dataDir);
  if (!fs.existsSync(meta)) return false;
  try {
    const m = JSON.parse(fs.readFileSync(meta, "utf8"));
    if ((m.version || 0) < 5) return false;
    const files = mediaFiles(mediaDir);
    const now = sourceStamp(files);
    if ((m.sources || []).length !== now.length) return false;
    return now.every((s, i) => {
      const prev = m.sources[i];
      return prev && prev.file === s.file && prev.bytes === s.bytes && prev.mtimeMs === s.mtimeMs;
    });
  } catch {
    return false;
  }
}

export async function buildIndex(mediaDir, dataDir, hooks = {}) {
  const files = mediaFiles(mediaDir);
  if (!files.length) {
    throw new Error(
      `No GeoJSON in ${mediaDir}. Place precincts-with-results.geojson.gz (or any *.geojson.gz) there.`,
    );
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const rows = [];
  const progress = hooks.onProgress || (() => {});
  for (const file of files) {
    hooks.onFile?.(path.basename(file));
    await scanGeojsonFile(
      file,
      (row) => {
        row.source = path.basename(file);
        rows.push(row);
      },
      { onProgress: (n) => progress({ file: path.basename(file), scanned: n, stored: rows.length }) },
    );
  }
  const stateStats = buildStateStats(rows);
  applyFlags(rows, stateStats);

  const byType = {};
  const byState = {};
  for (const m of METHODS) byType[m.id] = 0;
  for (const row of rows) {
    const st = row.stateFips || "?";
    if (!byState[st]) {
      byState[st] = {
        fips: st,
        name: row.stateName,
        precincts: 0,
        flagged: 0,
        byType: {},
      };
    }
    byState[st].precincts += 1;
    if (row.flags.length) {
      byState[st].flagged += 1;
      for (const id of row.flags) {
        byType[id] = (byType[id] || 0) + 1;
        byState[st].byType[id] = (byState[st].byType[id] || 0) + 1;
      }
    }
  }

  const { meta, precincts } = indexPaths(dataDir);
  const tmp = precincts + ".tmp";
  const ws = fs.createWriteStream(tmp);
  for (const row of rows) {
    ws.write(JSON.stringify(row) + "\n");
  }
  await new Promise((resolve, reject) => {
    ws.end(() => resolve());
    ws.on("error", reject);
  });
  fs.renameSync(tmp, precincts);

  const mappable = rows.filter((r) => r.lat != null && r.lng != null).length;
  const payload = {
    version: 5,
    indexedAt: new Date().toISOString(),
    sources: sourceStamp(files),
    precincts: rows.length,
    flagged: rows.filter((r) => r.flags.length).length,
    mappable,
    unmapped: rows.length - mappable,
    backend: databaseUrl() ? "postgres" : "jsonl",
    byType,
    states: Object.values(byState).sort((a, b) => a.name.localeCompare(b.name)),
    stateStats,
    methods: METHODS,
    candidates: resolveCandidates({ sourceName: files[0] ? path.basename(files[0]) : "" }),
  };
  fs.writeFileSync(meta, JSON.stringify(payload, null, 2));

  if (databaseUrl()) {
    const p = await getPool();
    await ensureSchema(p);
    await replacePrecincts(p, rows, payload);
    payload.backend = "postgres";
  }
  return { rows, meta: payload };
}

export function loadIndex(dataDir) {
  const { meta, precincts } = indexPaths(dataDir);
  if (!fs.existsSync(meta) || !fs.existsSync(precincts)) {
    return null;
  }
  const info = JSON.parse(fs.readFileSync(meta, "utf8"));
  const rows = [];
  const text = fs.readFileSync(precincts, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return { rows, meta: info };
}

export function explainRow(row, stateStats) {
  const st = stateStats?.[row.stateFips];
  return (row.flags || []).map((id) => ({
    id,
    why: whyFlagged(row, id, st),
  }));
}
